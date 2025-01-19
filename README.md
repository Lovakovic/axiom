# Observations 


## Tool

- Tools return message-like objects, content is similar to AI Studio msg content, though only text and images are supported
- InputSchema for tools returned from the server is object! -> has to be converted to zod for langchain 