const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

// 工具函数：加载远程 YAML 配置并解析为对象
async function loadYaml(url) {
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'Clash Verge' }
  });
  return yaml.load(response.data);
}

app.get('/', async (req, res) => {
  const subUrl = req.query.url; // 获取用户传入的订阅链接
  if (!subUrl) {
    return res.status(400).send('请提供订阅链接，例如 ?url=你的订阅地址');
  }
  
  try {
    // 1. 加载固定模板配置
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);
    
    // 2. 从订阅链接获取原始数据
    const response = await axios.get(subUrl, {
      headers: { 'User-Agent': 'Clash Verge' }
    });
    const rawData = response.data;

    // 3. 尝试 Base64 解码（如果数据经过编码）
    let decodedData;
    try {
      decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
      // 如果解码后数据中不含关键字，则直接使用原始数据
      if (!decodedData.includes('proxies:') &&
          !decodedData.includes('port:') &&
          !decodedData.includes('mixed-port:')) {
        decodedData = rawData;
      }
    } catch (e) {
      decodedData = rawData;
    }
    
    // 4. 判断数据格式：如果包含 proxies 或 port，则认为是标准 YAML 配置
    let subConfig = null;
    if (
      decodedData.includes('proxies:') ||
      decodedData.includes('port:') ||
      decodedData.includes('mixed-port:')
    ) {
      subConfig = yaml.load(decodedData);
      if (subConfig && typeof subConfig === 'object' && !Array.isArray(subConfig)) {
        if (subConfig['mixed-port'] !== undefined) {
          subConfig.port = subConfig['mixed-port'];
          delete subConfig['mixed-port'];
        }
      }
    } else {
      // 5. 否则，按自定义格式解析（每行一个节点，字段用 | 分隔）
      const proxies = decodedData
        .split('\n')
        .filter(line => line.trim())
        .map(line => {
          const parts = line.split('|');
          if (parts.length < 5) return null;
          const [type, server, port, cipher, password] = parts;
          return {
            // 原来自动生成名称为 `${server}-${port}`，这里我们直接覆盖为默认名称
            name: 'Default-sub',
            type: type || 'ss',
            server,
            port: parseInt(port),
            cipher: cipher || 'aes-256-gcm',
            password
          };
        })
        .filter(item => item !== null);
      subConfig = { proxies };
    }
    
    // 6. 强制将所有订阅数据中的代理节点名称都设置为 "Default-sub"
    if (subConfig && subConfig.proxies && Array.isArray(subConfig.proxies)) {
      subConfig.proxies = subConfig.proxies.map(proxy => {
        proxy.name = 'Default-sub';
        return proxy;
      });
      
      // 用订阅的代理列表替换固定模板中的 proxies
      fixedConfig.proxies = subConfig.proxies;
      
      // 同步更新模板中 proxy-groups 的代理名称列表
      if (fixedConfig['proxy-groups'] && Array.isArray(fixedConfig['proxy-groups'])) {
        fixedConfig['proxy-groups'] = fixedConfig['proxy-groups'].map(group => {
          if (group.proxies && Array.isArray(group.proxies)) {
            // 这里直接使用订阅中所有代理的名称
            return { ...group, proxies: subConfig.proxies.map(p => p.name) };
          }
          return group;
        });
      }
    }
    
    // 7. 输出最终的 YAML 配置（保持模板格式，同时使用最新的代理数据）
    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

module.exports = app;
