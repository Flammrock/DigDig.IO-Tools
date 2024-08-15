/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import Ajv from 'ajv'
import betterAjvErrors from 'better-ajv-errors'
import { Header } from '../types/tags'
import { HeaderSchema, HeaderSchemaNotStrict } from '../schemas'
import { ValidateFunction } from '../types/helpers'

/**
 * Validates the provided data to ensure it conforms to the structure of a UserScriptHeader.
 *
 * @param data The data to be validated.
 * @param allowUnknownKeys Whether to allow unknown keys in the provided data.
 * @returns A boolean indicating whether the data conforms to the structure of a UserScriptHeader.
 */
export const ValidateHeader: ValidateFunction<Partial<Header>> = (data: unknown, allowUnknowKeys: boolean = false) => {
  const ajv = new Ajv({
    strictTypes: true,
    allowUnionTypes: true,
    allErrors: true,
    ...(allowUnknowKeys
      ? {}
      : {
          removeAdditional: 'all'
        })
  })
  const schema = allowUnknowKeys ? HeaderSchemaNotStrict : HeaderSchema
  const validate = ajv.compile(schema)
  const isValid = validate(data)
  const errors = validate.errors == null ? [] : (validate.errors ?? [])

  if (isValid) {
    return { isValid: true, data: data as Partial<Header> }
  } else {
    return {
      isValid: false,
      errors: errors,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: betterAjvErrors(schema, data, errors as any)
    }
  }
}
