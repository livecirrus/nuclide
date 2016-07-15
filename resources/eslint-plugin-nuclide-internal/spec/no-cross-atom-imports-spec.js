'use strict';
/* @noflow */

/*
 * Copyright (c) 2015-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the LICENSE file in
 * the root directory of this source tree.
 */

/* eslint-disable max-len */

const path = require('path');

const rule = require('../no-cross-atom-imports');
const RuleTester = require('eslint').RuleTester;

const ruleTester = new RuleTester({
  parser: 'babel-eslint',
});

ruleTester.run('no-cross-atom-imports', rule, {
  valid: [
    //--------------------------------------------------------------------------
    // atom-1 => atom-1
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("../nuclide-fake-atom-package-1/file.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("./file.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("./");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // import
    {
      code: 'import "../nuclide-fake-atom-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "./file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "./";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export {}
    {
      code: 'export {} from "../nuclide-fake-atom-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "./file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "./";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export *
    {
      code: 'export * from "../nuclide-fake-atom-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "./file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "./";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // atom-1 => node-1
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("../nuclide-fake-node-package-1");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-1/file.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-1/index.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-1/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // import
    {
      code: 'import "../nuclide-fake-node-package-1";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-1/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-1/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export {}
    {
      code: 'export {} from "../nuclide-fake-node-package-1";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-1/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-1/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export *
    {
      code: 'export * from "../nuclide-fake-node-package-1";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-1/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-1/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-1/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // node-1 => node-2
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("../nuclide-fake-node-package-2");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-2/file.js");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-2/index.js");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("../nuclide-fake-node-package-2/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // import
    {
      code: 'import "../nuclide-fake-node-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "../nuclide-fake-node-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // export {}
    {
      code: 'export {} from "../nuclide-fake-node-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "../nuclide-fake-node-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // export *
    {
      code: 'export * from "../nuclide-fake-node-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "../nuclide-fake-node-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // atom-1 => node_modules
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("module-that-does-not-exit");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("eslint");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("eslint/lib/eslint.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'require("eslint/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // import
    {
      code: 'import "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export {}
    {
      code: 'export {} from "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export *
    {
      code: 'export * from "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export * from "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // node-1 => node_modules
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("module-that-does-not-exit");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("eslint");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("eslint/lib/eslint.js");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'require("eslint/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // import
    {
      code: 'import "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // export {}
    {
      code: 'export {} from "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export {} from "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // export *
    {
      code: 'export * from "module-that-does-not-exit";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "eslint";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "eslint/lib/eslint.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export * from "eslint/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // node-1 => atom-2 (type)
    //--------------------------------------------------------------------------

    // import type
    {
      code: 'import type x from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // import typeof
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    // export {}
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // atom-1 => atom-2 (type)
    //--------------------------------------------------------------------------

    // import type
    {
      code: 'import type x from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import type x from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // import typeof
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'import typeof x from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    // export {}
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },
    {
      code: 'export type {} from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
    },

    //--------------------------------------------------------------------------
    // whitelist
    //--------------------------------------------------------------------------
    {
      code: 'require("../nuclide-fake-atom-package-2");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      options: [{whitelist: ['nuclide-fake-atom-package-2']}],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      options: [{whitelist: ['nuclide-fake-atom-package-2']}],
    },
  ],
  invalid: [
    //--------------------------------------------------------------------------
    // node-1 => atom-2
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("../nuclide-fake-atom-package-2");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/file.js");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/index.js");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    // import
    {
      code: 'import "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    // export {}
    {
      code: 'export {} from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    // export *
    {
      code: 'export * from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-node-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },

    //--------------------------------------------------------------------------
    // atom-1 => atom-2
    //--------------------------------------------------------------------------

    // require
    {
      code: 'require("../nuclide-fake-atom-package-2");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/file.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/index.js");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    {
      code: 'require("../nuclide-fake-atom-package-2/package.json");',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not requireable from other packages.',
          type: 'CallExpression',
        },
      ],
    },
    // import
    {
      code: 'import "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    {
      code: 'import "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not importable from other packages.',
          type: 'ImportDeclaration',
        },
      ],
    },
    // export {}
    {
      code: 'export {} from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    {
      code: 'export {} from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportNamedDeclaration',
        },
      ],
    },
    // export *
    {
      code: 'export * from "../nuclide-fake-atom-package-2";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/file.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/index.js";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
    {
      code: 'export * from "../nuclide-fake-atom-package-2/package.json";',
      filename: path.join(__dirname, 'nuclide-fake-atom-package-1/index.js'),
      errors: [
        {
          message: 'Atom package "nuclide-fake-atom-package-2" is not exportable from other packages.',
          type: 'ExportAllDeclaration',
        },
      ],
    },
  ],
});
