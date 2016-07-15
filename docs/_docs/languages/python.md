---
pageid: language-python
title: Python
layout: docs
permalink: /docs/languages/python/
---

Nuclide has well-rounded support for Python 2 and 3.

* TOC
{:toc}

## Using Python Features with Buck Projects

If your code uses Buck to manage Python dependencies, you will need to build
your project's `python_binary` target in order for autocomplete and
jump to definition to find results from dependencies.

## Features

Python's integration into Nuclide provides you with productivity features such as:

- [Autocomplete](#features__autocomplete)
- [Jump To Definition](#features__jump-to-definition)
- [Code Formatting](#features__code-formatting)
- [Outline View](#features__outline-view)

### Autocomplete

Nuclide integrates [Jedi](http://jedi.jedidjah.ch/) to provide fast,
detailed, and context-aware autocompletion.

![](/static/images/docs/language-python-autocomplete.png)

By default, Nuclide will provide tab-able snippets for function and method
arguments. This behavior can be turned on or off at `Nuclide > Settings >
Language Settings > Python > Autocomplete arguments`.

### Jump to Definition

Nuclide allows you to directly jump to definition for local or imported symbols
alike.

For example, to go to the definition of `get_all_patches()`, you can
hover over `get_all_patches()`and either press `cmd-<mouse click>`
(`ctrl-<mouse click>` on Linux) or `cmd-option-Enter` (`ctrl-alt-Enter` on Linux).

![](/static/images/docs/language-python-jump-to-definition-link.png)

![](/static/images/docs/language-python-jump-to-definition-result.png)

Jump to definition also works for [Buck](http://buckbuild.com) config files.
Since `BUCK` files are written in Python, you can use `cmd-<mouse-click>`
(`ctrl-<mouse-click` on Linux) to jump to the various `BUCK` build targets
provided in the given `BUCK` file (e.g. `deps`).

### Code Formatting

With Nuclide, you can easily format your code or configure Nuclide to format on
save as long as you have [yapf](https://github.com/google/yapf) on your machine.

To format your code, press `cmd-shift-C` (`ctrl-shift-C` on Linux), or choose
the `Format Code` option from the context menu. This will only format code
within your text selection, or the whole file if no text is selected.

![](/static/images/docs/language-python-code-format-before.png)

![](/static/images/docs/language-python-code-format-after.png)

In order for the code formatting feature to work, make sure that:
- the code you want to format does not have any outstanding syntax errors.
- `yapf` is executing from the same python version as the code being formatted. For
example, formatting a Python 3 file while `yapf` is running on Python 2 will likely
not work.

### Outline View

Nuclide provides an [outline view](/docs/features/outline-view) to quickly see
and navigate the structure of your Python code.

![](/static/images/docs/language-python-outline-view.png)
