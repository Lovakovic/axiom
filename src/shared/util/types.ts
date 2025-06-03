import { ZodAny, ZodArray, ZodBoolean, ZodEnum, ZodNull, ZodNumber, ZodObject, ZodOptional, ZodString, ZodTypeAny } from 'zod';

export type JSONSchemaDraft7Property =
  | { type: 'string'; description?: string; enum?: string[]; [key: string]: any; }
  | { type: 'number'; description?: string; enum?: string[]; [key: string]: any; }
  | { type: 'boolean'; description?: string; enum?: string[]; [key: string]: any; }
  | { type: 'null'; description?: string; enum?: string[]; [key: string]: any; }
  | { type: 'object'; description?: string; enum?: string[]; properties: Record<string, JSONSchemaDraft7Property>; required?: string[]; [key: string]: any; }
  | { type: 'array'; description?: string; enum?: string[]; items: JSONSchemaDraft7Property; [key: string]: any; };

export interface JSONSchemaDraft7 {
  type: 'object';
  properties: Record<string, JSONSchemaDraft7Property>;
  required?: string[];
  [key: string]: any;
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