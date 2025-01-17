import { ZodAny, ZodArray, ZodBoolean, ZodEnum, ZodNull, ZodNumber, ZodObject, ZodOptional, ZodString, ZodTypeAny } from 'zod';

export type JSONSchemaDraft7Property =
  | { type: 'string'; description?: string; enum?: string[] }
  | { type: 'number'; description?: string; enum?: string[] }
  | { type: 'boolean'; description?: string; enum?: string[] }
  | { type: 'null'; description?: string; enum?: string[] }
  | { type: 'object'; description?: string; enum?: string[]; properties: Record<string, JSONSchemaDraft7Property>; required?: string[] }
  | { type: 'array'; description?: string; enum?: string[]; items: JSONSchemaDraft7Property };

export interface JSONSchemaDraft7 {
  type: 'object';
  properties: Record<string, JSONSchemaDraft7Property>;
  required?: string[];
}

export type ZodSchemaProps = Record<string, ZodTypeAny>;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ZodPropType =
  | ZodString
  | ZodNumber
  | ZodBoolean
  | ZodNull
  | ZodObject<Record<string, any>, 'strip', ZodTypeAny, Record<string, any>, Record<string, any>>
  | ZodArray<ZodPropType>
  | ZodEnum<[string, ...string[]]>
  | ZodOptional<ZodString>
  | ZodOptional<ZodNumber>
  | ZodOptional<ZodBoolean>
  | ZodOptional<ZodNull>
  | ZodOptional<ZodObject<Record<string, any>, 'strip', ZodTypeAny, Record<string, any>, Record<string, any>>>
  | ZodOptional<ZodArray<ZodPropType>>
  | ZodOptional<ZodEnum<[string, ...string[]]>>
  | ZodAny;
