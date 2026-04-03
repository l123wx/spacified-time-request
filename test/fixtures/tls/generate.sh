#!/bin/bash
# 生成自签名 TLS 证书用于测试

openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes -subj "/CN=localhost"
