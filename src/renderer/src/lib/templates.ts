// .gitignore and license templates offered when initializing a repository.

const COMMON = `# OS / editor files
.DS_Store
Thumbs.db
desktop.ini
.idea/
.vscode/*
!.vscode/settings.json
!.vscode/extensions.json
*.swp
`

export const GITIGNORE_TEMPLATES: Record<string, string> = {
  None: '',
  Node: `${COMMON}
# Node
node_modules/
dist/
build/
out/
coverage/
.env
.env.*
!.env.example
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
.npm/
.eslintcache
*.tsbuildinfo
`,
  'VisualStudio / .NET': `${COMMON}
# .NET / Visual Studio
[Bb]in/
[Oo]bj/
[Dd]ebug/
[Rr]elease/
x64/
x86/
.vs/
*.user
*.suo
*.userosscache
*.sln.docstates
*.rsuser
TestResults/
[Tt]est[Rr]esult*/
*.nupkg
packages/
!**/packages/build/
project.lock.json
artifacts/
appsettings.Development.json
*.log
`,
  Python: `${COMMON}
# Python
__pycache__/
*.py[cod]
*.egg-info/
.eggs/
build/
dist/
.venv/
venv/
env/
.env
.pytest_cache/
.mypy_cache/
.ruff_cache/
.coverage
htmlcov/
.ipynb_checkpoints/
`,
  'Java / Gradle': `${COMMON}
# Java / Gradle / Maven
*.class
*.jar
*.war
*.ear
.gradle/
build/
target/
out/
local.properties
`,
  'Flutter / Dart': `${COMMON}
# Flutter / Dart
.dart_tool/
.packages
.pub-cache/
.pub/
build/
.flutter-plugins
.flutter-plugins-dependencies
*.iml
android/.gradle/
android/local.properties
ios/Pods/
ios/.symlinks/
ios/Flutter/Generated.xcconfig
`,
  Android: `${COMMON}
# Android
*.apk
*.aab
*.ap_
.gradle/
build/
local.properties
captures/
.externalNativeBuild/
.cxx/
*.keystore
`,
  Go: `${COMMON}
# Go
bin/
*.exe
*.test
*.out
vendor/
go.work
`,
  Rust: `${COMMON}
# Rust
target/
**/*.rs.bk
`
}

const year = new Date().getFullYear()

export function licenseText(kind: string, holder: string): string {
  const who = holder || 'the authors'
  switch (kind) {
    case 'MIT':
      return `MIT License

Copyright (c) ${year} ${who}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`
    case 'ISC':
      return `ISC License

Copyright (c) ${year} ${who}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
`
    case 'BSD-2-Clause':
      return `BSD 2-Clause License

Copyright (c) ${year}, ${who}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
`
    case 'Unlicense':
      return `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or
distribute this software, either in source code form or as a compiled
binary, for any purpose, commercial or non-commercial, and by any
means.

For more information, please refer to <https://unlicense.org>
`
    default:
      return ''
  }
}

export const LICENSES = ['None', 'MIT', 'ISC', 'BSD-2-Clause', 'Unlicense']
