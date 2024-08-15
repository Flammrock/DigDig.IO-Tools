/*------------------------------------------------------------------*\
| Copyright (c) 2024 Flammrock                                       |
|                                                                    |
| This source code is licensed under the MIT license found in the    |
| LICENSE file in the root directory of this source tree.            |
\*------------------------------------------------------------------*/

import { EnumValue, Nullable, PermissiveObject, PermissiveString, PermissiveStringFixAutoCompletion } from './helpers'

export enum TagRunAt {
  DocumentStart = 'document-start',
  DocumentBody = 'document-body',
  DocumentEnd = 'document-end',
  DocumentIdle = 'document-idle',
  ContextMenu = 'context-menu'
}

export enum TagSandbox {
  Raw = 'raw',
  JavaScript = 'JavaScript',
  DOM = 'DOM'
}

export type TagResource = PermissiveString<{
  type: 'string'
  uri: 'string'
}>

export type SingleValue<T = string> = PermissiveString<T>
export type SingleValueNullable<T = string> = Nullable<SingleValue<T>>

export type MultipleValue<T = string> = PermissiveString<Array<SingleValue<T>>>
export type MultipleValueNullable<T = string> = Nullable<MultipleValue<T>>

export type I18NValue<T = string> = SingleValue<
  Partial<
    PermissiveObject<{
      default: SingleValue<T>
    }>
  >
>
export type I18NValueNullable<T = string> = Nullable<I18NValue<T>>
export type MultipleI18NValue<T = string> = PermissiveString<Array<I18NValue<T>>>

/**
 * @see https://www.tampermonkey.net/documentation.php?locale=en
 */
export interface Header {
  /**
   * The name of the script.
   */
  name: I18NValue

  /**
   * The namespace of the script.
   */
  namespace: SingleValue

  /**
   * A copyright statement shown at the header of the script's editor right below the script name.
   */
  copyright: SingleValue

  license: SingleValue

  /**
   * The script version. This is used for the update check
   * and needs to be increased at every update.
   *
   * In this list the next entry is considered to be a higher
   * version number, eg: `Alpha-v1` < `Alpha-v2` and `16.4` == `16.04`
   *
   * - `Alpha-v1`
   * - `Alpha-v2`
   * - `Alpha-v10`
   * - `Beta`
   * - `0.5pre3`
   * - `0.5prelimiary`
   * - `0.6pre4`
   * - `0.6pre5`
   * - `0.7pre4`
   * - `0.7pre10`
   * - `1.-1`
   * - `1 == 1. == 1.0 == 1.0.0`
   * - `1.1a`
   * - `1.1aa`
   * - `1.1ab`
   * - `1.1b`
   * - `1.1c`
   * - `1.1.-1`
   * - `1.1 == 1.1.0 == 1.1.00`
   * - `1.1.1.1.1`
   * - `1.1.1.1.2`
   * - `1.1.1.1`
   * - `1.10.0-alpha`
   * - `1.10 == 1.10.0`
   * - `1.11.0-0.3.7`
   * - `1.11.0-alpha`
   * - `1.11.0-alpha.1`
   * - `1.11.0-alpha+1`
   * - `1.12+1 == 1.12+1.0`
   * - `1.12+1.1 == 1.12+1.1.0`
   * - `1.12+2`
   * - `1.12+2.1`
   * - `1.12+3`
   * - `1.12+4`
   * - `1.12`
   * - `2.0`
   * - `16.4 == 16.04`
   * - `2023-08-17.alpha`
   * - `2023-08-17`
   * - `2023-08-17_14-04 == 2023-08-17_14-04.0`
   * - `2023-08-17+alpha`
   * - `2023-09-11_14-0`
   */
  version: SingleValue

  /**
   * A short significant description.
   */
  description: I18NValue

  /**
   * The script icon in low res.
   */
  icon: SingleValue

  /**
   * This scripts icon in 64x64 pixels. If this tag, but &commat;icon is given the &commat;icon
   * image will be scaled at some places at the options page.
   */
  icon64: SingleValue

  /**
   * &commat;grant is used to whitelist `GM_*` and `GM.*` functions, the `unsafeWindow`
   * object and some powerful `window` functions.
   * If set to `null`, the sandbox is disabled. In this mode no `GM_*` function
   * but the `GM_info` property will be available.
   * If no &commat;grant tag is given an empty list is assumed. However this different from using `null`.
   *
   * Here, `null` is used to represent the 'none' option (e.g. &commat;grant none).
   *
   * @example
   * ```typescript
   * [
   *   'GM_setValue'
   *   'GM_getValue'
   *   'GM.setValue'
   *   'GM.getValue'
   *   'GM_setClipboard'
   *   'unsafeWindow'
   *   'window.close'
   *   'window.focus'
   *   'window.onurlchange'
   * ]
   * ```
   */
  grant: MultipleValueNullable

  /**
   * The scripts author.
   */
  author: SingleValue

  /**
   * The authors homepage that is used at the options page to link from the
   * scripts name to the given page. Please note that if the &commat;namespace tag
   * starts with `http://` its content will be used for this too.
   */
  homepage: SingleValue

  /**
   * This tag allows script developers to disclose whether they monetize their scripts.
   * It is for example required by [GreasyFork](https://greasyfork.org/).
   *
   * Syntax: &lt;tag&gt; &lt;type&gt; &lt;description&gt;
   *
   * &lt;type&gt; can have the following values:
   * - `ads`
   * - `tracking`
   * - `miner`
   */
  antifeature: MultipleI18NValue

  /**
   * Points to a JavaScript file that is loaded and executed before the script
   * itself starts running. Note: the scripts loaded via &commat;require and their "use strict"
   * statements might influence the userscript's strict mode!
   */
  require: MultipleValue

  /**
   * Preloads resources that can by accessed via `GM_getResourceURL` and `GM_getResourceText` by the script.
   *
   * Syntax: &lt;tag&gt; &lt;type&gt; &lt;uri&gt;
   */
  resource: MultipleValue<TagResource>

  /**
   * The pages on that a script should run. Multiple tag instances are allowed.
   * &commat;include doesn't support the URL hash parameter. You have to match
   * the path without the hash parameter and make use of `window.onurlchange`
   *
   * **Note**: When writing something like `*://tmnk.net/*` many script developers
   * expect the script to run at `tmnk.net` only, but this is not the case.
   * It also runs at `https://example.com/?http://tmnk.net/` as well.
   *
   * Therefore Tampermonkey interprets &commat;includes that contain a `://` a
   * little bit like &commat;match. Every `*` before `://` only matches
   * everything except `:` characters to makes sure only the URL scheme is matched.
   * Also, if such an &commat;include contains a `/` after `://`, then everything between
   * those strings is treat as host, matching everything except `/` characters.
   * The same applies to `*` directly following `://`.
   *
   * @example
   * ```typescript
   * [
   *   'http://www.tampermonkey.net/*'
   *   'http://*'
   *   'https://*'
   *   '/^https:\/\/www\.tampermonkey\.net\/.*$/'
   *   '*'
   * ]
   * ```
   */
  include: MultipleValue

  /**
   * In Tampermonkey, the &commat;match directive is used to specify the web pages that
   * your script should run on. The value of &commat;match should be a URL pattern that
   * matches the pages you want your script to run on. Here are the parts of
   * the URL pattern that you'll need to set:
   *
   * ``<protocol>://<domain><path>``
   *
   * - protocol - This is the first part of the URL, before the colon.
   *   It specifies the protocol that the page uses, such as `http` or `https`.
   *   `*` matches both.
   * - domain - This is the second part of the URL, after the protocol and two slashes.
   *   It specifies the domain name of the website, such as `tmnk.com`. You can use the
   *   wildcard character this way `*.tmnk.net` to match tmnk.net and any sub-domain of it like `www.tmnk.net`.
   * - path - This is the part of the URL that comes after the domain name, and may include
   *   additional subdirectories or filenames. You can use the wildcard
   *   character `*` to match any part of the path.
   *
   * Please check this documentation to get more information about match pattern.
   *
   * **Note**: the `<all_urls>` statement is not yet supported and the scheme part also accepts `http*://`.
   *
   * @example
   * ```typescript
   * [
   *   'https://*.tampermonkey.net/foo*bar'
   * ]
   * ```
   */
  match: MultipleValue

  /**
   * Exclude URLs even it they are included by &commat;include or &commat;match.
   */
  exclude: MultipleValue

  /**
   * Defines the moment the script is injected. In opposition to other script handlers,
   * &commat;run-at defines the first possible moment a script wants to run.
   * This means it may happen, that a script that uses the &commat;require tag may be executed after
   * the document is already loaded, cause fetching the required script took that long. Anyhow, all
   * DOMNodeInserted and DOMContentLoaded events that happended after the given injection moment are
   * cached and delivered to the script when it is injected.
   *
   * - `'document-start'`: The script will be injected as fast as possible.
   * - `'document-body'`: The script will be injected if the body element exists.
   * - `'document-end'`: The script will be injected when or after the DOMContentLoaded event was dispatched.
   * - `'document-idle'`: The script will be injected after the DOMContentLoaded event was dispatched.
   *                    This is the default value if no &commat;run-at tag is given.
   * - `'context-menu'`: The script will be injected if it is clicked at the browser context menu.
   *                   Note: all &commat;include and &commat;exclude statements will be ignored if this value is used,
   *                   but this may change in the future.
   */
  runAt: SingleValue<EnumValue<TagRunAt>>

  /**
   * &commat;sandbox allows Tampermonkey to decide where the userscript is injected:
   *
   * `MAIN_WORLD` - the page
   * `ISOLATED_WORLD` - the extension's content script
   * `USERSCRIPT_WORLD` - a special context created for userscripts
   *
   * But instead of specifying an environment, the userscript can express what exactly it
   * needs access to. &commat;sandbox supports three possible arguments:
   *
   * - `'raw'`: "Raw" access means that a script for compatibility reasons always needs to
   * run in page context, the `MAIN_WORLD`. At the moment this mode is the default if &commat;sandbox
   * is omitted. If injection into the `MAIN_WORLD` is not possible (e.g. because of a CSP)
   * the userscript will be injected into other (enabled) sandboxes according to the
   * order of this list.
   *
   * - `'JavaScript'`: "JavaScript" access mode means that this script needs access to
   * `unsafeWindow`. At Firefox a special context, the `USERSCRIPT_WORLD`, is created which also
   * bypasses existing CSPs. It however, might create new issues since now cloneInto and exportFunction
   * are necessary to share objects with the page. raw mode is used as fallback at other browsers.
   *
   * - `'DOM'`: Use this access mode if the script only needs DOM and no direct `unsafeWindow` access.
   * If enabled these scripts are executed inside the extension context, the `ISOLATED_WORLD`, or at
   * any other enabled context otherwise, because they all grant DOM access.
   */
  sandbox: SingleValue<EnumValue<TagSandbox>>

  /**
   * This tag defines the domains (no top-level domains) including subdomains which
   * are allowed to be retrieved by `GM_xmlhttpRequest`.
   *
   * Can be:
   * - a domain name like `example.com` (this will also allow all subdomains).
   * - a subdomain name like `subdomain.example.com`.
   * - `self` to whitelist the domain the script is currently running at.
   * - `localhost` to access the localhost.
   * - an IP address like `1.2.3.4`.
   * - `*`
   *
   * If it's not possible to declare all domains a userscript might connect to then it's
   * a good practice to do the following:
   *
   * 1. Declare _all known_ or at least _all common_ domains that might be connected by
   * the script to avoid the confirmation dialog for most users.
   * Additionally add &commat;connect `*` to the script to allow Tampermonkey to offer an
   * "Always allow all domains" button.
   * 2. Users can also whitelist all requests by adding `*` to the user domain whitelist
   * at the script settings tab.
   *
   * **Notes**:
   *
   * - Both, the initial **and** the final URL will be checked!
   * - For backward compatibility to Scriptish &commat;domain tags are interpreted as well.
   * - Multiple tag instances are allowed.
   *
   * @example
   * ```typescript
   * [
   *   'tmnk.net',
   *   'www.tampermonkey.net',
   *   'self',
   *   'localhost',
   *   '8.8.8.8',
   *   '*'
   * ]
   * ```
   */
  connect: MultipleValue

  /**
   * This tag makes the script running on the main pages, but not at iframes.
   */
  noframes: boolean

  /**
   * An update URL for the userscript.
   *
   * **Note**: a &commat;version tag is required to make update checks work.
   */
  updateURL: SingleValue

  /**
   * Defines the URL where the script will be downloaded from when an update was detected.
   * If the value _none_ is used, then no update check will be done.
   */
  downloadURL: SingleValue

  /**
   * Defines the URL where the user can report issues and get personal support.
   */
  supportURL: SingleValue

  /**
   * &commat;webRequest takes a JSON document that matches `GM_webRequest`'s `rule` parameter.
   * It allows the rules to apply even before the userscript is loaded.
   */
  webRequest: SingleValue

  /**
   * Injects the userscript without any wrapper and sandbox into the page,
   * which might be useful for Scriptlets.
   */
  unwrap: boolean
}

export type HeaderStrict = Partial<Header>

export type HeaderNotStrict = PermissiveObject<Partial<Header>>

export type HeaderKey = PermissiveStringFixAutoCompletion<keyof Header>
