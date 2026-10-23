param([switch]$Online,[string]$Task='assembleDebug',[string]$ToolsRoot='C:\work\work\FY26\12 埃及PCR成品库\.android-tools',[string]$Sdk='C:\Users\wangquanjin\AppData\Local\Android\Sdk')
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$env:JAVA_HOME=Join-Path $ToolsRoot 'jdk-17'
$env:GRADLE_USER_HOME='C:\Users\wangquanjin\.gradle'
$env:ANDROID_HOME=$Sdk
$sdkLine='sdk.dir='+$Sdk.Replace('\','/')
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'local.properties'),$sdkLine)
node build-assets.cjs
if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}
$gradleRoot=Join-Path $ToolsRoot 'gradle-8.9'
$jvm=@('--add-opens=java.base/java.util=ALL-UNNAMED','--add-opens=java.base/java.lang=ALL-UNNAMED','--add-opens=java.base/java.lang.invoke=ALL-UNNAMED','--add-opens=java.prefs/java.util.prefs=ALL-UNNAMED','--add-exports=jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED','--add-exports=jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED','--add-opens=java.base/java.nio.charset=ALL-UNNAMED','--add-opens=java.base/java.net=ALL-UNNAMED','--add-opens=java.base/java.util.concurrent.atomic=ALL-UNNAMED','-Xmx1536m','-Dfile.encoding=UTF-8','-Duser.country=US','-Duser.language=en','-Duser.variant=',"-javaagent:$gradleRoot\lib\agents\gradle-instrumentation-agent-8.9.jar")
if ($Online) { $jvm += @('-Dhttps.proxyHost=127.0.0.1','-Dhttps.proxyPort=12334','-Dhttp.proxyHost=127.0.0.1','-Dhttp.proxyPort=12334') }
$mode=if($Online){'--no-watch-fs'}else{'--offline'}
& "$env:JAVA_HOME\bin\java.exe" @jvm -classpath "$gradleRoot\lib\gradle-gradle-cli-main-8.9.jar" org.gradle.launcher.GradleMain --no-daemon $mode --console=plain $Task
exit $LASTEXITCODE
