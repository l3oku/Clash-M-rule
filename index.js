const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

app.get('/', async (req, res) => {
  const subUrl = req.query.url;
  if (!subUrl) {
    return res.status(400).send('请提供订阅链接，例如 ?url=你的订阅地址');
  }

  try {
    const response = await axios.get(subUrl, {
      headers: { 'User-Agent': 'Clash Verge' }
    });
    const rawData = response.data;

    // 尝试 Base64 解码
    let decodedData;
    try {
      decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
    } catch (e) {
      decodedData = rawData;
    }

    // 尝试解析为 YAML
    try {
      const configFromYaml = yaml.load(decodedData);
      if (configFromYaml && typeof configFromYaml === 'object' && !Array.isArray(configFromYaml) && configFromYaml.proxies) {
        if (configFromYaml['mixed-port'] !== undefined) {
          configFromYaml.port = configFromYaml['mixed-port'];
          delete configFromYaml['mixed-port'];
        }
        res.set('Content-Type', 'text/yaml');
        return res.send(yaml.dump(configFromYaml));
      }
    } catch (e) {
      // 不是有效的 YAML 配置，继续
    }

    // 按自定义格式解析，确保代理名称唯一
    const proxyNames = new Set();
    const proxies = decodedData
      .split('\n')
      .filter(line => line.trim())
      .map((line, index) => {
        const parts = line.split('|');
        if (parts.length < 5) return null;
        const [type, server, port, cipher, password] = parts;
        let baseName = `${server}-${port}`;
        let name = baseName;
        let counter = 1;
        while (proxyNames.has(name)) {
          name = `${baseName}-${counter}`;
          counter++;
        }
        proxyNames.add(name);
        return {
          name,
          type: type || 'ss',
          server,
          port: parseInt(port),
          cipher: cipher || 'aes-256-gcm',
          password
        };
      })
      .filter(item => item !== null);

    // 生成 Clash 配置
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
​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​​
