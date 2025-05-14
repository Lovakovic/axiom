## 1. Overview of the Problems

### A. Interruption Challenges
- **Primary Issue – Interruption:**  
  When the user interrupts mid-generation (via Ctrl+C), we must preserve the partial state so that the next agent run continues correctly. Interruptions can occur during:
  1. **Tool Call Generation:** The LLM is generating a tool call instruction.
  2. **Tool Execution:** Although tool execution happens in the background (via ToolNode), our state must correctly reflect that a tool call was generated.
  3. **Response Generation:** The LLM is streaming a natural language reply.

### B. State Consistency
- **In‑Memory State:**  
  We need a custom in‑memory state (using LangChain message class instances) that is exactly what we send to the LLM API. This state must reflect the complete conversation history, including full HumanMessages, AIMessage instructions (including tool calls), and ToolMessages from ToolNode.
- **No Extra Transformation:**  
  Since the LLM accepts the LangChain message class instances directly (as seen in the callModel method), our state can be maintained in that native form.

---

## 2. Message Types, Stream Events, and Their Roles

### A. Key Message Classes
- **HumanMessage:** Represents user input.
- **AIMessage:** Represents the model’s natural language reply. It may include a `tool_calls` field if a tool call instruction was generated.
- **ToolMessage:** Represents the result from executing a tool call.  
  **Important:** ToolMessages are never surfaced to the CLI; they are only recorded to state via the graph’s reducer.
- **Message Chunks:** (e.g. AIMessageChunk, ToolMessageChunk) These accumulate content during streaming.

### B. Stream Events and Their Meaning
- **text_delta:** A stream of text chunks from the model’s reply.
- **MessageEvent:** Emitted when the model finishes generating a reply. This event signals that the full text is ready to be recorded.
- **ToolEvent:** Emitted when the LLM finishes generating a tool call instruction.  
  **Clarification:** The ToolEvent is not the result of executing a tool; it merely signals that the LLM produced a complete tool call instruction. The actual execution is handled by the ToolNode, which then produces a ToolMessage that is recorded to the conversation state.

- **tool_input_delta:** Streams parts of the tool call instruction (before the ToolEvent finalizes it).

---

## 3. State Structure and Buffering Strategy

### A. In-Memory Conversation State
- **State Array:**  
  The complete conversation history is maintained as an array of LangChain message instances:
  ```ts
  let conversationState: BaseMessage[] = [];
  ```
- **Direct Use:**  
  These instances are passed directly to the LLM API without further transformation.

### B. Transient Buffers (For State Recovery)
- **Purpose:**  
  Buffers are used only to accumulate the full content that will eventually be recorded to the state (to recover in case of interruption). They are not used for CLI display (which is handled by printing events as they occur).

- **Example Buffers:**
  ```ts
  let currentResponseBuffer: string = "";
  let currentToolCallBuffer: string = "";
  ```

- **Usage:**
  - For each `text_delta` event, append content to `currentResponseBuffer`.
  - For each `tool_input_delta` event, append content to `currentToolCallBuffer`.
  - Upon receiving a final MessageEvent or ToolEvent, the appropriate buffer is converted into a full message.

---

## 4. Detailed Scenarios and Handling Strategies

### 4.1. Normal Flow (Without Interruption)

#### A. Agent Response Generation (Phase D)
- **Streaming:**
  - On every `text_delta` event, append the chunk to `currentResponseBuffer` and print the event directly to the CLI.

- **Finalization:**
  - When a MessageEvent is received (indicating that the model’s reply is complete), create an AIMessage and push it to `conversationState`:
    ```ts
    const completeResponse = new AIMessage({ content: currentResponseBuffer });
    conversationState.push(completeResponse);
    currentResponseBuffer = "";
    ```

#### B. Tool Call Generation (Phase B)
- **Streaming:**
  - As `tool_input_delta` events arrive, accumulate the tool call instruction in `currentToolCallBuffer` and print it to the CLI.

- **Finalization via ToolEvent:**
  - When a ToolEvent is emitted (indicating the LLM has finished generating a tool call instruction), merge the buffered tool call text into the corresponding AIMessage. For example:
    ```ts
    let lastAIMessage = conversationState[conversationState.length - 1] as AIMessage;
    lastAIMessage.content = mergeContent(lastAIMessage.content, `\nTool Call: ${currentToolCallBuffer}`);
    currentToolCallBuffer = "";
    ```
  - **Note:** This ToolEvent is solely the LLM’s output indicating a tool call. The tool execution result is not available in this event.

#### C. Tool Execution (Phase C)
- **Execution:**
  - After the tool call instruction is generated (and recorded in the AIMessage), the ToolNode takes over the execution.
  - The tool result is processed internally and returned as a ToolMessage by ToolNode.
  - The ToolMessage is then recorded to state via the reducer, without ever being printed to the CLI.
  - Example:
    ```ts
    const toolResult = await executeToolCall(...);
    const toolMsg = new ToolMessage({ content: toolResult, tool_call_id: toolCallId });
    conversationState.push(toolMsg);
    ```

---

### 4.2. Interruption Handling

#### Scenario 1: Interruption During Tool Call Generation
- **Situation:**  
  The LLM is in the middle of generating a tool call instruction (content is accumulating in `currentToolCallBuffer`) when interrupted.

- **Strategy:**
  - Preserve the partial tool call in the buffer.
  - On the next agent run, convert the incomplete tool call (stored in `currentToolCallBuffer`) into a plain AIMessage, indicating that it was interrupted.

- **Example:**
  ```ts
  if (interruptionOccurred && currentToolCallBuffer) {
    const partialToolCallMsg = new AIMessage({ content: `Interrupted Tool Call: ${currentToolCallBuffer}` });
    conversationState.push(partialToolCallMsg);
    currentToolCallBuffer = "";
  }
  ```

#### Scenario 2: Interruption During Tool Execution
- **Situation:**  
  The AIMessage contains a generated tool call instruction, but the ToolNode has not completed executing the tool call.

- **Strategy:**
  - Update the last AIMessage to convert the structured tool call metadata into plain text.
  - This prevents the LLM API from expecting corresponding ToolMessages that were never produced.

- **Example:**
  ```ts
  if (interruptionOccurred && lastAIMessage.tool_calls?.length) {
    lastAIMessage.content = mergeContent(lastAIMessage.content, "\n[Tool call was interrupted – execution incomplete]");
    delete lastAIMessage.tool_calls;
  }
  ```

#### Scenario 3: Interruption During Agent Response Generation
- **Situation:**  
  The model is streaming a natural language reply, and content is accumulating in `currentResponseBuffer` when interrupted.

- **Strategy:**
  - Finalize the partial response by converting the accumulated text into an AIMessage and push it to the state.

- **Example:**
  ```ts
  if (interruptionOccurred && currentResponseBuffer) {
    const partialResponseMsg = new AIMessage({ content: currentResponseBuffer });
    conversationState.push(partialResponseMsg);
    currentResponseBuffer = "";
  }
  ```

---

## 5. End-to-End Blueprint

### A. Recording and Buffering
1. **User Input:**
  - Immediately create a HumanMessage and add it to the conversation state:
    ```ts
    const humanMsg = new HumanMessage({ content: userInput });
    conversationState.push(humanMsg);
    ```

2. **Streaming Events:**
  - For each `text_delta` event, append text to `currentResponseBuffer`.
  - For each `tool_input_delta` event, append text to `currentToolCallBuffer`.
  - Print each event directly to the CLI as it comes in.

### B. Finalizing Messages on Event Completion
1. **On MessageEvent:**
  - Convert the accumulated `currentResponseBuffer` into an AIMessage and push to state.
2. **On ToolEvent:**
  - Merge the `currentToolCallBuffer` into the last AIMessage (or create a separate message if needed).
  - Note: This event merely indicates that the LLM generated the tool call instruction; the tool result (ToolMessage) comes later from the ToolNode.

### C. Handling Interruptions
1. **Detecting Interruptions:**
  - Use flags or AbortControllers to catch interruption events.

2. **Finalize Partial Content:**
  - Depending on the phase, convert the partial buffer content into a plain message (as shown in the examples above) and add it to the conversation state.

### D. State Usage for LLM API Calls
- **Direct API Call:**
  Since our conversation state consists of full LangChain message instances, pass it directly to the LLM API:
  ```ts
  const response = await llmAPI.invoke({ messages: conversationState });
  ```

---

## 6. Summary

- **Key Clarification:**
  - **ToolEvent vs. ToolMessage:**  
    A ToolEvent is emitted when the LLM finishes generating a tool call instruction. It is not the execution result. The execution result comes later as a ToolMessage from the ToolNode and is only recorded to state (not displayed on the CLI).

- **State & Buffer Usage:**
  - Buffers are used solely for accumulating the full content to be sent to the LLM in case of interruptions. They do not affect the CLI output.
  - The conversation state is maintained as LangChain message instances and used directly by the LLM API.

- **Interruption Scenarios:**  
  Detailed strategies handle interruptions during:
  1. Tool call generation (convert partial tool call to plain text).
  2. Tool execution (modify AIMessage to remove structured tool call metadata).
  3. Response generation (finalize partial response as an AIMessage).
