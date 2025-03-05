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

// 接口1：转换订阅数据，将订阅中的代理合并到固定模板中
app.get('/', async (req, res) => {
  const subUrl = req.query.url; // 获取用户传入的订阅链接
  if (!subUrl) {
    return res.status(400).send('请提供订阅链接，例如 ?url=你的订阅地址');
  }
  
  try {
    // 1. 加载固定 YAML 配置作为模板
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);
    
    // 2. 从订阅链接获取原始数据，同时转发客户端请求头
    const clientHeaders = {
      'User-Agent': req.headers['user-agent'] || 'Clash Verge',
      'Cookie': req.headers['cookie'] || ''
    };
    const response = await axios.get(subUrl, {
      headers: clientHeaders
    });
    const rawData = response.data;
    
    // 3. 尝试 Base64 解码（如果数据经过编码）
    let decodedData;
    try {
      decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
      // 如果解码后不含关键字，则认为原始数据就是明文
      if (!decodedData.includes('proxies:') && !decodedData.includes('port:') && !decodedData.includes('mixed-port:')) {
        decodedData = rawData;
      }
    } catch (e) {
      decodedData = rawData;
    }
    
    // 4. 根据数据内容判断是否为 YAML 格式
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
      // 5. 尝试解析为自定义格式（每行一个节点，字段用 | 分隔）
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
      subConfig = { proxies };
    }
    
    // 6. 将订阅中的代理列表嫁接到固定模板中
    if (subConfig && subConfig.proxies && subConfig.proxies.length > 0) {
      fixedConfig.proxies = subConfig.proxies;
      
      if (fixedConfig['proxy-groups']) {
        fixedConfig['proxy-groups'] = fixedConfig['proxy-groups'].map(group => {
          if (group.proxies && Array.isArray(group.proxies)) {
            // 更新为订阅代理的名称列表
            return { ...group, proxies: subConfig.proxies.map(p => p.name) };
          }
          return group;
        });
      }
    }
    
    // 7. 输出最终的 YAML 配置
    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

// 接口2：/proxy 接口直接 302 重定向到订阅链接，让客户端直接请求
app.get('/proxy', (req, res) => {
  const subUrl = req.query.url;
  if (!subUrl) return res.status(400).send('请提供订阅链接，例如 ?url=你的订阅地址');
  
  // 302 重定向，使客户端直接请求机场订阅链接，流量能正确计入
  res.redirect(302, subUrl);
});

module.exports = app;
