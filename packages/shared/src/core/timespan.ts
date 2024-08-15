/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

/**
 * A class representing a time span with a maximum resolution of milliseconds.
 */
export class TimeSpan {
  private milliseconds: number

  /**
   * Private constructor to initialize the time span in milliseconds.
   * @param {number} milliseconds - The time span in milliseconds.
   */
  private constructor(milliseconds: number) {
    this.milliseconds = milliseconds
  }

  /**
   * Creates a TimeSpan instance from milliseconds.
   * @param {number} milliseconds - The time span in milliseconds.
   * @returns {TimeSpan} A new TimeSpan instance.
   */
  public static fromMilliseconds(milliseconds: number): TimeSpan {
    return new TimeSpan(milliseconds)
  }

  /**
   * Creates a TimeSpan instance from seconds.
   * @param {number} seconds - The time span in seconds.
   * @returns {TimeSpan} A new TimeSpan instance.
   */
  public static fromSeconds(seconds: number): TimeSpan {
    return new TimeSpan(seconds * 1000)
  }

  /**
   * Creates a TimeSpan instance from minutes.
   * @param {number} minutes - The time span in minutes.
   * @returns {TimeSpan} A new TimeSpan instance.
   */
  public static fromMinutes(minutes: number): TimeSpan {
    return new TimeSpan(minutes * 60 * 1000)
  }

  /**
   * Creates a TimeSpan instance from hours.
   * @param {number} hours - The time span in hours.
   * @returns {TimeSpan} A new TimeSpan instance.
   */
  public static fromHours(hours: number): TimeSpan {
    return new TimeSpan(hours * 60 * 60 * 1000)
  }

  /**
   * Creates a TimeSpan instance from days.
   * @param {number} days - The time span in days.
   * @returns {TimeSpan} A new TimeSpan instance.
   */
  public static fromDays(days: number): TimeSpan {
    return new TimeSpan(days * 24 * 60 * 60 * 1000)
  }

  /**
   * Gets the total time span in milliseconds.
   * @returns {number} The total time span in milliseconds.
   */
  public totalMilliseconds(): number {
    return this.milliseconds
  }

  /**
   * Gets the total time span in seconds.
   * @returns {number} The total time span in seconds.
   */
  public totalSeconds(): number {
    return this.milliseconds / 1000
  }

  /**
   * Gets the total time span in minutes.
   * @returns {number} The total time span in minutes.
   */
  public totalMinutes(): number {
    return this.milliseconds / (60 * 1000)
  }

  /**
   * Gets the total time span in hours.
   * @returns {number} The total time span in hours.
   */
  public totalHours(): number {
    return this.milliseconds / (60 * 60 * 1000)
  }

  /**
   * Gets the total time span in days.
   * @returns {number} The total time span in days.
   */
  public totalDays(): number {
    return this.milliseconds / (24 * 60 * 60 * 1000)
  }

  /**
   * Adds another TimeSpan to the current time span.
   * @param {TimeSpan} timeSpan - The TimeSpan to add.
   * @returns {TimeSpan} A new TimeSpan instance representing the sum.
   */
  public add(timeSpan: TimeSpan): TimeSpan {
    return new TimeSpan(this.milliseconds + timeSpan.totalMilliseconds())
  }

  /**
   * Subtracts another TimeSpan from the current time span.
   * @param {TimeSpan} timeSpan - The TimeSpan to subtract.
   * @returns {TimeSpan} A new TimeSpan instance representing the difference.
   */
  public subtract(timeSpan: TimeSpan): TimeSpan {
    return new TimeSpan(this.milliseconds - timeSpan.totalMilliseconds())
  }
}
