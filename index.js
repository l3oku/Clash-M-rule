const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

app.get('/', async (req, res) => {
  const subUrl = req.query.url; // 从 URL 参数获取订阅链接
  if (!subUrl) {
    return res.status(400).send('请提供订阅链接，例如 ?url=你的订阅地址');
  }
  
  try {
    // 从订阅链接获取原始数据
    const response = await axios.get(subUrl, {
      headers: { 'User-Agent': 'Clash Verge' }
    });
    const rawData = response.data;

    // 尝试Base64解码，解码后的数据如果看起来不是 YAML（缺少 proxies、port 等关键字），则直接使用原始数据
    let decodedData;
    try {
      decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
      if (!decodedData.includes('proxies:') && !decodedData.includes('port:') && !decodedData.includes('mixed-port:')) {
        decodedData = rawData;
      }
    } catch (e) {
      decodedData = rawData;
    }

    // 如果数据中包含 proxies 或 port 关键字，则认为它是完整的 YAML 配置
    if (
      decodedData.includes('proxies:') ||
      decodedData.includes('port:') ||
      decodedData.includes('mixed-port:')
    ) {
      let configFromYaml = yaml.load(decodedData);
      if (configFromYaml && typeof configFromYaml === 'object' && !Array.isArray(configFromYaml)) {
        if (configFromYaml['mixed-port'] !== undefined) {
          configFromYaml.port = configFromYaml['mixed-port'];
          delete configFromYaml['mixed-port'];
        }
        res.set('Content-Type', 'text/yaml');
        return res.send(yaml.dump(configFromYaml));
      }
    }
    
    // 否则，尝试按照自定义格式解析（假设每行一个节点，字段以 | 分隔）
    const proxies = decodedData
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const parts = line.split('|');
        if (parts.length < 5) return null;
        const [type, server, port, cipher, password] = parts;
        return {
          name: `${server}-${port}`,
          type: type || 'ss',
          server,
          port: parseInt(port),
          cipher: cipher || 'aes-256-gcm',
          password
        };
      })
      .filter(item => item !== null);

    // 生成新版 Clash 配置文件
    const config = {
      port: 7890,
      'socks-port': 7891,
      'allow-lan': true,
      mode: 'Rule',
      'log-level': 'info',
      proxies: proxies,
      'proxy-groups': [
        {
          name: 'Auto',
          type: 'url-test',
          proxies: proxies.map(p => p.name),
          url: 'http://www.gstatic.com/generate_204',
          interval: 300
        }
      ],
      rules: [
        'DOMAIN-SUFFIX,google.com,Auto',
        'GEOIP,CN,DIRECT',
        'MATCH,Auto'
      ],
      dns: {
        enable: true,
        listen: '0.0.0.0:53',
        nameserver: [
          '114.114.114.114',
          '8.8.8.8'
        ]
      }
    };

    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(config));
  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

module.exports = app;
