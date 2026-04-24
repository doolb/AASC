# 资源目录实现文档（伪代码）

## 1. 路径解析伪代码

```text
RES_DIR = <project>/res
```

## 2. 服务端路径装配伪代码

```text
RES_DIR = <project>/res

UPLOADS_DIR = res/uploads
ASR_TEMP_DIR = res/temp/asr
HTTP_UPLOAD_TEMP_DIR = res/temp/uploads
SSL_KEY_PATH = res/certs/key.pem
SSL_CERT_PATH = res/certs/cert.pem
```

## 3. ASR 模型目录伪代码

```text
preferredModelDir = res/models/sensevoice
modelDir = preferredModelDir
```

## 4. 临时文件清理伪代码

```text
tempDirs = [ASR_TEMP_DIR, HTTP_UPLOAD_TEMP_DIR]
遍历 tempDirs 清理超过阈值的文件
```
