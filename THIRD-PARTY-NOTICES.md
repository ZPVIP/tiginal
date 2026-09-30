# Third-Party Notices & Attribution

This project incorporates open-source software packages and components under various permissive licenses. In accordance with the terms of those licenses, the relevant notices, copyright statements, and disclaimers are reproduced below.

Tiginal itself is distributed under the **GNU General Public License v3.0 (or later)**. All included third-party libraries retain their original copyrights and license terms.

---

## 📋 Open Source Dependencies & Licenses Summary

| Component / Package | License | Author / Copyright Holder |
|---|---|---|
| **Electron & Chromium** | MIT / BSD-3-Clause | Copyright (c) GitHub, Inc. & Google LLC |
| **xterm.js & addons** | MIT | Copyright (c) Microsoft Corporation |
| **node-pty** | MIT | Copyright (c) Microsoft Corporation |
| **React & React DOM** | MIT | Copyright (c) Meta Platforms, Inc. and affiliates |
| **wavesurfer.js** | BSD-3-Clause | Copyright (c) 2012-2024 katspaugh |
| **Lucide Icons** | ISC | Copyright (c) Lucide Contributors |
| **Tailwind CSS & PostCSS** | MIT | Copyright (c) Tailwind Labs, Inc. |
| **Framer Motion** | MIT | Copyright (c) Framer B.V. |
| **Cheerio** | MIT | Copyright (c) 2012 Matt Mueller |
| **better-sqlite3** | MIT | Copyright (c) Joshua Wise |
| **Argon2** | MIT | Copyright (c) Ranisalt |
| **Ajv (JSON Schema)** | MIT | Copyright (c) Evgeny Poberezkin |
| **Tesseract.js** | Apache-2.0 | Copyright (c) Jerome Wu |
| **ws (WebSocket)** | MIT | Copyright (c) Einar Otto Stangvik |
| **clap (Rust)** | MIT / Apache-2.0 | Copyright (c) Clap Developers |
| **ort (ONNX Runtime)** | MIT / Apache-2.0 | Copyright (c) Pyke Software & ONNX Runtime authors |
| **hound (Rust)** | Apache-2.0 | Copyright (c) Ruud van Asseldonk |
| **realfft (Rust)** | MIT / Apache-2.0 | Copyright (c) Henrik Söderström |
| **serde & serde_json** | MIT / Apache-2.0 | Copyright (c) Erick Tryzelaar and David Tolnay |
| **whisper-rs & whisper.cpp** | MIT | Copyright (c) Georgi Gerganov & whisper-rs contributors |

---

## 📜 Full License Notices of Permissive Dependencies

### 1. The MIT License
Used by *xterm.js, node-pty, React, Framer Motion, Cheerio, better-sqlite3, Argon2, Ajv, ws, whisper-rs, and others*:

```text
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
```

---

### 2. The BSD-3-Clause License
Used by *wavesurfer.js, Chromium components*:

```text
Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

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
```

---

### 3. The ISC License
Used by *Lucide Icons, which*:

```text
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
```

---

### 4. Apache License, Version 2.0
Used by *Tesseract.js, @pierre/trees, hound*:

```text
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

---

## 🧠 AI Model Weights & Separation of Licenses

Tiginal provides native features to download, load, and execute third-party machine learning models and neural network weights. Please note:

1. **Software vs. Model Weights**:
   - The source code of Tiginal is distributed under **GPL-3.0-or-later**.
   - Machine learning model weights, pre-trained checkpoints, and language models (e.g. Whisper weights, Nemotron-3 checkpoints, MMS-Align models, and third-party GGUF models) are independent creative works governed by their respective originators' licenses.
2. **Third-Party Model Terms**:
   - **OpenAI Whisper Models**: MIT License.
   - **NVIDIA Nemotron-3 Diarization**: Governed by the [NVIDIA Open Model License Agreement](https://developer.nvidia.com/open-model-license). Commercial use is permitted subject to acceptable use policies and attribution.
   - **Meta MMS-Align Models**: Governed by Meta AI research licenses.
   - **GGUF Models (Llama, Qwen, Mistral, etc.)**: Each model downloaded via the Model Library or third-party repositories is subject to its individual publisher's license.
