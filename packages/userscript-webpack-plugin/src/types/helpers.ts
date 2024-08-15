/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { ErrorObject } from 'ajv'

export type Nullable<T> = T | null

export type PermissiveObject<T> = T & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

/**
 * An helper type to force VS Code to prevent the autocomplete to
 * break when doing thing like this:
 *
 * ```typescript
 * type Foo = 'hello' | 'world'
 * type Bar = Foo | string
 * ```
 *
 * To prevent this weird behavior, the following trick work:
 *
 * ```typescript
 * type Foo = 'hello' | 'world'
 * type Bar = Foo | (string & NonNullable<unknown>)
 * ```
 *
 * **Warning**: this trick might fail in the future but it is only used
 * to have the convenience of autocompletion
 *
 *
 * @see https://stackoverflow.com/questions/74467392/autocomplete-in-typescript-of-literal-type-and-string
 */
export type PermissiveStringFixAutoCompletion<T> = T | (string & NonNullable<unknown>)

export type PermissiveString<T> = T | string

export type EnumValue<T extends string> = T | `${T}`

export interface RegExpObject {
  expression: string
  flags: Array<string>
}

export type ValidateFunctionBadResult = {
  isValid: false
  errors: Array<ErrorObject>
  message: string
}

export type ValidateFunctionGoodResult<T> = {
  isValid: true
  data: T
}

export type ValidateFunctionResult<T> = ValidateFunctionGoodResult<T> | ValidateFunctionBadResult

export interface ValidateFunction<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]): ValidateFunctionResult<T>
}
