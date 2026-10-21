# Windows CEのARM／Thumbバイナリ解析

この派生版は、Windows 10以降の64ビットPC上でREAとGhidraを動かし、Windows CE用の実行ファイルを解析します。REAをWindows CEへインストールする変更ではありません。対象を実行せずに調べる静的解析に対応し、EXEとDLLの関数、文字列、参照関係、逆コンパイル結果を既存のCLIとMCPから取得します。MCPは、AIがREAの解析機能を呼び出すための接続方式です。

## 対応するファイル

| 条件                                                                      | この派生版での扱い         |
| ------------------------------------------------------------------------- | -------------------------- |
| PE32、Machine `0x01C0`または`0x01C2`、Subsystem `9`、ネイティブのEXE／DLL | Windows版Ghidraへ渡す      |
| 旧ARM／ThumbでSubsystemが9以外、または不明                                | 拒否する                   |
| Machineが不明、実行形式でないファイル、.NET管理コード                     | このGhidra経路では拒否する |
| 既存のARMNT、ARM64、x86、x64                                              | 既存の条件を維持する       |

MachineとSubsystemは、ファイル形式を読む共通処理で一度だけ取得します。Ghidraへの受入判定にはその値を使い、Windows ARMの解析条件にも残します。解析条件が異なる保存済み結果を取り違えないよう、Subsystemも解析条件の識別値に含めます。[MicrosoftのPE仕様](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format)では、`0x01C0`はARM、`0x01C2`はThumb、Subsystem `9`はWindows CE GUIです。

## セットアップと実行

必要なGhidra、JDK、Node.js、NTFSの条件は[Windows Ghidra](windows-ghidra-p0.md)と同じです。ソースから使う場合は、`package.json`と同じ版のWindows専用部品を[native/windows/README.md](../native/windows/README.md#restore-the-artifact-in-a-source-checkout)の手順で復元します。別バージョンの部品への差し替えや、部品の検証を無効にする操作は不要です。

```powershell
git clone --branch codex/windows-ce-arm-analysis https://github.com/unpeita/rea.git rea-windows-ce
cd rea-windows-ce
npm ci
# native/windows/README.mdに従い、同じ版のWindows専用部品を復元する
npm run build:cached
$env:GHIDRA_INSTALL_DIR = "C:\tools\ghidra_12.1.4_PUBLIC"
$env:JAVA_HOME = "C:\tools\jdk-21"
node scripts/rea.mjs inspect "C:\targets\sample-ce.dll" --provider ghidra --json
node scripts/rea.mjs decompile "C:\targets\sample-ce.dll" 0x10001000 --provider ghidra --json
```

アドレスは解析対象の関数に合わせて指定します。大きなファイルで起動待ち時間が足りない場合は、プロセス単位で`REA_GHIDRA_STARTUP_TIMEOUT_MS`を設定できます。例えば`900000`は15分です。解析未完了の結果は成功として返しません。

MCPを利用する場合も、このブランチからビルドした`node scripts/rea.mjs mcp`を起動し、同じGhidraとJDKを指定します。既存の`open_binary`、`procedure_pseudo_code`などをそのまま使えます。[接続設定例](windows-ghidra-p0.md#configuration)のREAのパスを、このチェックアウトのパスに置き換えます。

## 再実行できる検証

```powershell
npm run test:local -- src/domain/binaryTarget.test.ts src/ghidra/GhidraProvider.behavior.test.ts
npm run verify:ghidra:windows-ce
npm run check
```

検証用の生成スクリプトは、ARMとThumbそれぞれのEXE／DLLを`build/fixtures/`へ作ります。外部のSDKやOSイメージは使いません。関数`CeAnswer`は42を返し、`CeCaller`はその値に1を加えます。実際のGhidraを使う検証では、4ファイルの関数をMCPから逆コンパイルしてこの動作を確認します。さらにThumb DLLで、CLIとMCPのファイル位置指定の一致、不正な位置指定の拒否、原本保持、解析終了時の後片付けを検査します。

人工ファイルは命令解釈とREA接続の検証用です。Windows CE上での実行可能性や、特定コンパイラーのすべての出力を再現するものではありません。

## 保守解析で残る制約

GhidraのPE読込み処理に命令体系の選択を任せています。表示される`ARM:LE:32:v8`などはGhidraの解析モデルであり、実機のCPU世代を確定する根拠にはなりません。旧C++コードでは、引数の渡し方、`this`ポインター、構造体、Windows CEのAPI型を個別に照合する必要があります。逆コンパイル結果は元のソースコードそのものではありません。

原本を固定して複製を解析する処理、Windowsのアクセス権検証、子プロセスの終了管理は既存の仕組みを維持します。Windows版では解析データベースへの注釈変更も引き続き提供しません。

Windows CEのOSイメージ、アプリ本体、復元コードはこの公開リポジトリに含めません。QEMUで動くCE環境が手元にあっても、REAからQEMUの状態やゲストのメモリを取得する接続は、この変更には含まれていません。実行時解析を追加するには、対象プロセスの識別、実行時のロード先と静的解析アドレスの対応、命令停止時のメモリ読出しを検証する必要があります。汎用のCE OSが起動することと、特定機種のドライバーやHMIが正常動作することは、別々に確認します。
