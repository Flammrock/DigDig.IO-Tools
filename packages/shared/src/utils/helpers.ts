/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 *
 */
export type Nullable<T> = T | null

export type Writeable<T> = { -readonly [K in keyof T]: T[K] }

export type StripPrefix<T extends string, P extends string> = T extends `${P}${infer U}` ? U : T
