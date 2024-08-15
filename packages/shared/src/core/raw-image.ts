/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

export enum RawImageFormat {
  RGBA
}

/**
 *
 */
export interface RawImage {
  data: Uint8ClampedArray
  format: RawImageFormat
  width: number
  height: number
}
