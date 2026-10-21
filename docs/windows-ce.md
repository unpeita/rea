# Windows CEのARM／Thumbバイナリ解析

この派生版は、Windows 10以降の64ビットPC上でREAとGhidraを動かし、Windows CE用の実行ファイルを解析します。REAをWindows CEへインストールする変更ではありません。対象を実行せずに調べる静的解析では、EXEとDLLの関数、文字列、参照関係、逆コンパイル結果を取得します。追加したエミュレーター連携では、起動済みのQEMUからCPUレジスター、実行状態、メモリを取得します。どちらもCLIとMCPから利用できます。MCPは、AIがREAの解析機能を呼び出すための接続方式です。

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

Windows CEのOSイメージ、アプリ本体、復元コードはこの公開リポジトリに含めません。汎用のCE OSが起動することと、特定機種のドライバーやHMIが正常動作することは、別々に確認します。

## staticメンバー関数の余分なthisを補正する

32ビットARM、PE、Subsystem 9の解析では、Ghidraの通常解析後にC++の装飾名を調べます。装飾名は、関数名とともに引数の型やstatic指定を記録した名前です。staticと確認でき、明示引数の数が一致し、Ghidraが自動追加した先頭の`this`だけが余っている場合に、ARM解析モデルの既定の引数配置へ戻します。元の明示引数と戻り値の型は保持します。

通常のインスタンス関数、利用者が型を指定した関数、独自の引数配置を持つ関数、装飾名が矛盾する関数には適用しません。装飾名が残っていない関数の推測補正も行いません。解析条件に`windows_ce_static_members: decorated-static-no-this-v1`を記録するため、補正前の保存済み結果とは区別されます。変更するのは解析用の一時データベースです。

```powershell
npm run verify:ghidra:windows-ce-cpp
```

人工DLLのstatic関数は2引数のまま、インスタンス関数は`this`と2引数のままであることを、実際のGhidraとMCPで検証します。

## QEMUの実行状態とメモリを読む

QMPは、QEMUの状態を問い合わせる管理用通信です。既存のQEMU起動設定へ、次のオプションを追加します。名前とUUIDはREAへの入力と一致させます。UUIDは仮想マシンを区別する識別番号です。すべてゼロの既定UUIDは受け付けません。

```text
-name ce-maintenance -uuid 927fa260-a1b2-4c3d-8e9f-0123456789ab
-qmp tcp:127.0.0.1:50777,server=on,wait=off
```

既存のディスクを使う検証では、書込みを一時差分へ分離する`-drive ...,snapshot=on`を使います。ネットワークが不要なら`-nic none`を指定します。REAの接続機能自体はQEMUを起動・停止・再開せず、各呼出しの終了時に接続を閉じます。

```powershell
node scripts/rea.mjs inspect-emulator-state --port 50777 --expected_name ce-maintenance --expected_uuid 927fa260-a1b2-4c3d-8e9f-0123456789ab --json
node scripts/rea.mjs read-emulator-memory --port 50777 --expected_name ce-maintenance --expected_uuid 927fa260-a1b2-4c3d-8e9f-0123456789ab --address 0x800010c0 --length 32 --address_space physical --json
```

メモリを読む前に、利用者がQEMUの管理画面などで一時停止させます。REAは`running=false`かつ`status=paused`を要求し、読取り中に実行再開などの通知を受けた場合も失敗として返します。起動直後の`prelaunch`など、`paused`以外の状態では読みません。1回の読取りは1～4096バイト、アドレスは32ビットです。通信全体は10秒、受信データは1 MiBに制限します。

MCPでは`inspect_emulator_state`と`read_emulator_memory`を使います。入力名は`expected_name`、`expected_uuid`、`cpu_index`、`address_space`です。`cpu_index`は仮想CPUの番号で、省略時は0です。状態、レジスター文字列、読取りバイト列、接続先と観測条件を、REA共通の根拠データであるEvidenceとして返します。

`address_space=physical`は物理アドレス、`virtual`は選択した仮想CPUの現在のアドレス空間です。Windows CEのプロセス番号やDLL名を指定する機能はありません。静的解析アドレスとの対応は、ロード先の確認と元ファイルのバイト列との照合が必要です。また、別のデバッガーやデバイスがメモリを変える可能性があり、すべての値を厳密に同時取得した結果ではありません。

読取り先には既知のRAMを指定してください。メモリ上に配置されたデバイスレジスターを読むと、割込み解除などの副作用が起こる場合があります。REAはRAMとデバイスのアドレスを自動判別しないため、メモリ読取りツールの権限表示にもこの変更可能性を反映しています。接続先の名前とUUIDの一致は取り違え防止用であり、相手を認証する仕組みではありません。

通信とメモリ表示形式は[QEMU Monitorの仕様](https://www.qemu.org/docs/master/system/monitor.html)に従います。

## エミュレーター連携の再検証

```powershell
npm run test:focused -- tests/boundary/emulator/qmp.test.ts
$env:REA_QEMU_COMMAND = "C:\tools\qemu\qemu-system-arm.exe"
npm run verify:qemu:memory
```

この検証はOSやアプリを使わず、人工ARM命令だけをQEMUへ読み込みます。物理／仮想メモリの一致、CLIとMCPの結果の一致、実行中の読取り拒否を確認し、自分で起動したQEMUを終了します。Windows x64、QEMU 11.1.0、Ghidra 12.1.4で確認しました。ほかの版・ホストOSは未検証です。
