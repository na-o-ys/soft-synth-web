# soft-synth-web

MIDI 鍵盤をつなぐとやわらかいシンセ音で鳴る、ブラウザ版のシンセ。
macOS 常駐版 [soft-synth](https://github.com/na-o-ys/soft-synth) の Web 移植で、音源・設定ファイルの形式は同じ。

- サイン波ベースの加算合成 + 軽い FDN リバーブ（AudioWorklet で動作）
- 32 音ポリフォニー、サステインペダル（CC64）対応
- Web MIDI で USB / OS 接続済みの鍵盤を自動検出（抜き差しに追従）
- Web Bluetooth で BLE MIDI 鍵盤に直接接続（Audio MIDI 設定での接続は不要、切れたら自動で再接続を試みる）
- プリセットとノブ・パッド・ストリップの割り当てを JSON で設定し、ブラウザ内に保存
- 全パラメータをスライダーで操作でき、MIDI で動かした値も画面に反映される
- PC のキーボードでも演奏できる（A W S E D F T G Y H U J K、Z / X でオクターブ）

## 動かす

ビルド不要の静的ファイルのみ。AudioWorklet と Web MIDI は `file://` では動かないので HTTP で配信する。

```sh
node serve.mjs        # http://localhost:5173/
```

ブラウザで開いて「音を出す」を押す（ブラウザの仕様上、最初の 1 回は操作が必要）。

| ブラウザ | Web MIDI | Web Bluetooth |
|---|---|---|
| Chrome / Edge | ○ | ○ |
| Firefox | ○ | × |
| Safari | × | × |

## 設定

形式はネイティブ版と同じ（パラメータ・プリセット・controls の詳細は
[soft-synth の README](https://github.com/na-o-ys/soft-synth#設定ファイル) を参照）。
画面の「設定（JSON）」で編集して「適用して保存」を押すと反映され、このブラウザに保存される。
誤りがあると場所を示すエラーを出し、直前の設定のまま動き続ける。

ひな形:

- [configs/default.json](configs/default.json): 一般的な鍵盤向け（ピッチベンド、モジュレーション、GM 標準の CC 7/72/73/74/91/93）
- [configs/smk25ii.json](configs/smk25ii.json): M-VAVE SMK-25 II 向け（ノブ 8 本、PITCH / MOD ストリップ、パッド 16 個）

自分の鍵盤用の割り当ては、ログ欄の「受信した MIDI メッセージも表示する」をオンにして
ノブやパッドを触り、表示された番号を controls に書けばよい。

## 構成

| ファイル | 役割 |
|---|---|
| `src/synth-worklet.js` | 音源（AudioWorklet）。ボイス管理・加算合成・エンベロープ・リバーブ |
| `src/config.js` | 設定の既定値と JSON の検証 |
| `src/controller.js` | MIDI メッセージ → パラメータ操作・アクション・ノート |
| `src/midi.js` | Web MIDI 入力と Web Bluetooth（BLE MIDI パケットの解析） |
| `src/main.js` | 画面と各部品の結線 |

## ネイティブ版との違い

- タブを開いている間だけ鳴る（ログイン時の自動起動や常駐はしない）
- Bluetooth 鍵盤は「Bluetooth MIDI 鍵盤に接続」ボタンで一度選ぶ必要がある（ブラウザの仕様）
- OS 側でも同じ鍵盤が接続されている場合、Web MIDI 側の同名の入力は無視して二重に鳴らないようにしている
