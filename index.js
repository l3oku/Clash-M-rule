const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash' } });
  return yaml.load(response.data);
}

// 捕获所有路径
app.get('/*', async (req, res) => {
  // 关键修改：使用 req.originalUrl 来获取完整的原始路径，包括查询参数
  // 例如，请求 "https://your-domain.com/https://a.com/sub?token=123"
  // req.originalUrl 会是 "/https://a.com/sub?token=123"
  // .slice(1) 后就得到了完整的、未经破坏的订阅地址
  const subUrl = req.originalUrl.slice(1);

  // 优化了入口判断逻辑
  if (!subUrl || subUrl === 'favicon.ico') {
    const host = req.get('host');
    const protocol = req.protocol;
    return res.status(400).send(
      `欢迎使用！\n请直接在域名后拼接您的订阅链接即可。\n\n例如: ${protocol}://${host}/你的订阅地址`
    );
  }
  
  try {
    // --- 后续核心逻辑与你的原始代码完全相同，无需改动 ---

    // 加载模板配置
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);
    
    // 确保proxies字段存在且为数组
    if (!Array.isArray(fixedConfig.proxies)) {
      fixedConfig.proxies = [];
    }

    // 获取订阅数据
    const response = await axios.get(subUrl, { headers: { 'User-Agent': 'Clash' } });
    let decodedData = response.data;
    
    // Base64解码处理
    try {
      const tempDecoded = Buffer.from(decodedData, 'base64').toString('utf-8');
      if (tempDecoded.includes('proxies:') || tempDecoded.includes('proxy-groups:') || tempDecoded.includes('rules:')) {
        decodedData = tempDecoded;
      }
    } catch (e) {
      // 解码失败，忽略错误
    }

    // 解析订阅数据
    let subConfig;
    if (decodedData.includes('proxies:')) {
      subConfig = yaml.load(decodedData);
    } else {
      // 自定义格式解析
      subConfig = {
        proxies: decodedData.split('\n')
          .filter(line => line.trim())
          .map(line => {
            const parts = line.split('|');
            return parts.length >= 5 ? {
              name: `${parts[1]}-${parts[2]}`,
              type: parts[0] || 'ss',
              server: parts[1],
              port: parseInt(parts[2]),
              cipher: parts[3] || 'aes-256-gcm',
              password: parts[4]
            } : null;
          })
          .filter(Boolean)
      };
    }

    // 核心逻辑：混合模板与订阅代理 (这部分完全是您原来的逻辑)
    if (subConfig?.proxies?.length > 0) {
      const templateProxies = [...fixedConfig.proxies];
      if (templateProxies.length > 0) {
        const subProxy = subConfig.proxies[0];
        templateProxies[0] = {
          ...templateProxies[0],
          server: subProxy.server,
          port: subProxy.port || templateProxies[0].port,
          password: subProxy.password || templateProxies[0].password,
          cipher: subProxy.cipher || templateProxies[0].cipher,
          type: subProxy.type || templateProxies[0].type
        };
      }
      const mergedProxies = [...templateProxies, ...subConfig.proxies];
      const seen = new Map();
      fixedConfig.proxies = mergedProxies.filter(proxy => {
        if (!proxy?.name) return false;
        if (!seen.has(proxy.name)) {
          seen.set(proxy.name, true);
          return true;
        }
        return false;
      });
      if (Array.isArray(fixedConfig['proxy-groups'])) {
        fixedConfig['proxy-groups'] = fixedConfig['proxy-groups'].map(group => {
          if (group.name === 'PROXY' && Array.isArray(group.proxies)) {
            return {
              ...group,
              proxies: group.proxies.filter(name => 
                fixedConfig.proxies.some(p => p.name === name)
              )
            };
          }
          return group;
        });
      }
    }

    res.set('Content-Type', 'text/yaml; charset=utf-8');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    console.error('Error processing subscription:', error);
    res.status(500).send(`处理订阅链接时发生错误。\n请检查链接是否正确: ${subUrl}\n错误详情: ${error.message}`);
  }
});

module.exports = app;
