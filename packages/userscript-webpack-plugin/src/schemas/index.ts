/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import HeaderSchemaNotStrictJson from './header-not-strict.schema.json'
import HeaderSchemaJson from './header-strict.schema.json'
import ConfigurationSchemaJson from './configuration-not-strict.schema.json'

/**
 * JSON schema for validating and describing the structure of partial Configuration objects.
 * This schema defines the expected properties and their types for configuring UserScript headers.
 *
 * @example
 * Should be use along with the package `ajv` like this:
 * ```
 * import Ajv from 'ajv'
 * import { ConfigurationSchema } from 'userscript-webpack-plugin'
 *
 * const ajv = new Ajv()
 * const validate = ajv.compile(ConfigurationSchema)
 * const isValid = validate(config)
 * ```
 *
 * @see {@link ValidateConfiguration}
 */
export const ConfigurationSchema = ConfigurationSchemaJson

export const HeaderSchema = HeaderSchemaJson
export const HeaderSchemaNotStrict = HeaderSchemaNotStrictJson
