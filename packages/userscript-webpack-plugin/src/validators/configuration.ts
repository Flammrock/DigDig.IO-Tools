/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import Ajv from 'ajv'
import betterAjvErrors from 'better-ajv-errors'
import { Configuration } from '../types/configuration'
import { ConfigurationSchema } from '../schemas'
import { ValidateFunction } from '../types/helpers'

/**
 * Validates the provided data against the UserScriptHeaderConfigurationSchema
 * to ensure it conforms to the expected structure.
 *
 * @param data The data to be validated.
 * @returns True if the data matches the expected structure of a
 *          partial UserScriptHeaderConfiguration, otherwise false.
 */
export const ValidateConfiguration: ValidateFunction<Partial<Configuration>> = (data: unknown) => {
  const ajv = new Ajv({
    strictTypes: true,
    allowUnionTypes: true,
    allErrors: true,
    removeAdditional: 'all'
  })
  const validate = ajv.compile(ConfigurationSchema)
  const isValid = validate(data)
  const errors = validate.errors == null ? [] : (validate.errors ?? [])

  if (isValid) {
    return { isValid: true, data: data as Partial<Configuration> }
  } else {
    return {
      isValid: false,
      errors: errors,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      message: betterAjvErrors(ConfigurationSchema, data, errors as any)
    }
  }
}
