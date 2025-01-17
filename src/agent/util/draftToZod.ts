import { z, ZodObject, ZodTypeAny } from 'zod';
import { JSONSchemaDraft7, JSONSchemaDraft7Property, ZodPropType, ZodSchemaProps } from './types';

/**
 * Converts a JSON Schema Draft 7 or a string representation of it into a Zod schema.
 * @param {JSONSchemaDraft7 | string} schema - The JSON Schema Draft 7 or its string representation.
 * @returns {ZodObject<ZodSchemaProps> | undefined} The converted Zod schema or undefined if the conversion fails.
 */
export const convertJSONSchemaDraft7ToZod = (schema: JSONSchemaDraft7 | string): ZodObject<ZodSchemaProps> => {
  try {
    const parsedSchema: JSONSchemaDraft7 = parseSchema(schema);
    validateSchemaType(parsedSchema);

    const zodSchemaProps = convertPropertiesToZod(parsedSchema.properties, parsedSchema.required);

    return z.object(zodSchemaProps);
  } catch (e) {
    console.error('Failed to convert JSON Schema to Zod:', e);
    throw e;
  }
};

/**
 * Parses the input schema. If it's a string, it parses it as JSON.
 * @param {JSONSchemaDraft7 | string} schema - The input schema.
 * @returns {JSONSchemaDraft7} The parsed schema.
 */
const parseSchema = (schema: JSONSchemaDraft7 | string): JSONSchemaDraft7 => {
  return typeof schema === 'string' ? JSON.parse(schema) : schema;
};

/**
 * Validates that the top level schema is of type 'object'.
 * @param {JSONSchemaDraft7} schema - The schema to validate.
 * @throws {Error} If the top level schema is not of type 'object'.
 */
const validateSchemaType = (schema: JSONSchemaDraft7): void => {
  if (schema.type !== 'object') {
    throw new Error('Top level schema must be an object type');
  }
};

/**
 * Converts the properties of a JSON schema to Zod types.
 * @param {Record<string, JSONSchemaDraft7Property>} properties - The properties of the JSON schema to convert.
 * @param {string[]} [required=[]] - The list of required properties in the JSON schema.
 * @returns {ZodSchemaProps} An object with the converted properties.
 */
const convertPropertiesToZod = (properties: Record<string, JSONSchemaDraft7Property>, required: string[] = []): ZodSchemaProps => {
  const zodSchemaProps: ZodSchemaProps = {};

  for (const key in properties) {
    const prop = properties[key];
    let zodProp: ZodTypeAny = convertTypeToZod(prop);

    zodProp = handleEnumAndDescription(prop, zodProp);
    zodProp = handleOptionalProperties(required, key, zodProp);

    zodSchemaProps[key] = zodProp;
  }

  return zodSchemaProps;
};

/**
 * Converts a single JSON schema type to a Zod type.
 * @param {JSONSchemaDraft7Property} prop - The type to convert.
 * @returns {ZodTypeAny} The converted Zod type.
 * @throws {Error} If the type is unsupported.
 */
const convertTypeToZod = (prop: JSONSchemaDraft7Property): ZodPropType => {
  switch (prop.type) {
    case 'string': {
      return z.string();
    }
    case 'number': {
      return z.number();
    }
    case 'boolean': {
      return z.boolean();
    }
    case 'null': {
      return z.null();
    }
    case 'object': {
      if (!prop.properties) {
        throw new Error('Object type must have a "properties" property');
      }
      return z.object(convertPropertiesToZod(prop.properties, prop.required));
    }
    case 'array': {
      if (!prop.items) {
        throw new Error('Array type must have an "items" property');
      }
      const itemSchema: ZodTypeAny = convertTypeToZod(prop.items);
      return z.array(itemSchema);
    }
    default: {
      throw new Error(`Unsupported JSON Schema type: ${prop}`);
    }
  }
};

/**
 * Handles the 'enum' and 'description' properties of the JSON schema.
 * @param {Object} prop - The property to handle.
 * @param {ZodPropType} zodProp - The Zod property to modify.
 * @returns {ZodPropType} The modified Zod property.
 * @throws {Error} If the enum values are not an array of strings with at least one element.
 */
const handleEnumAndDescription = (prop: JSONSchemaDraft7Property, zodProp: ZodPropType): ZodPropType => {
  if (prop.enum) {
    if (Array.isArray(prop.enum) && prop.enum.every((item: any): item is string => true) && prop.enum.length > 0) {
      zodProp = z.enum(prop.enum as [string, ...string[]]).describe(prop.description ?? '');
    } else {
      throw new Error('Enum values must be an array of strings with at least one element');
    }
  } else if (prop.description) {
    zodProp = zodProp.describe(prop.description);
  }

  return zodProp;
};

/**
 * Handles optional properties in the JSON schema.
 * @param {string[]} required - The array of required properties.
 * @param {string} key - The key of the property to handle.
 * @param {ZodPropType} zodProp - The Zod property to modify.
 * @returns {ZodPropType} The modified Zod property.
 */
const handleOptionalProperties = (required: string[], key: string, zodProp: ZodTypeAny): ZodTypeAny => {
  if (!required.includes(key)) {
    // Check if the property is already optional
    if (zodProp._def.typeName !== 'ZodOptional') {
      return zodProp.optional();
    }
  }
  return zodProp;
};
