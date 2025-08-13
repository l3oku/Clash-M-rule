const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash Verge' } });
  return yaml.load(response.data);
}

app.get('/*', async (req, res) => {
  // 修复点 1: 使用 req.originalUrl 来获取完整的路径和查询参数
  const originalUrlPath = req.originalUrl;

  // 如果用户只访问根域名，返回提示
  if (originalUrlPath === '/') {
    return res.status(400).send('请在域名后直接拼接订阅链接，https://clashmeta.ikee.eu.org/你的订阅地址');
  }

  // 修复点 2: 从完整路径中截取掉开头的 '/'
  let subUrl = originalUrlPath.substring(1);

  // 健壮性优化: 对URL进行解码，以防止客户端自动编码导致链接不正确
  // 例如，客户端可能会将 https://... 编码为 https%3A%2F%2F...
  try {
      subUrl = decodeURIComponent(subUrl);
  } catch (e) {
      // 如果解码失败，很可能是因为URL没被编码，直接使用原始URL即可
      console.warn('URL解码失败，将使用原始URL:', subUrl);
  }


  // --- 从这里开始，后面的所有代码逻辑都与您原来的一模一样，无需改动 ---

  try {
    // 加载模板配置
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);

    // 确保proxies字段存在且为数组
    if (!Array.isArray(fixedConfig.proxies)) {
      fixedConfig.proxies = [];
    }

    // 获取订阅数据
    const response = await axios.get(subUrl, { headers: { 'User-Agent': 'Clash Verge' } });
    let decodedData = response.data;

    // Base64解码处理
    try {
      const tempDecoded = Buffer.from(decodedData, 'base64').toString('utf-8');
      if (tempDecoded.includes('proxies:') || tempDecoded.includes('port:')) {
        decodedData = tempDecoded;
      }
    } catch (e) {}

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
    
    // 核心逻辑：混合模板与订阅代理 (这部分完全保留，确保节点信息不会丢失)
    if (subConfig?.proxies?.length > 0) {
      // 1. 保留模板所有代理
      const templateProxies = [...fixedConfig.proxies];

      // 2. 替换第一个代理的服务器信息（保留名称）
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

      // 3. 合并代理列表（模板代理 + 订阅代理）
      const mergedProxies = [...templateProxies, ...subConfig.proxies];

      // 4. 根据名称去重（保留第一个出现的代理）
      const seen = new Map();
      fixedConfig.proxies = mergedProxies.filter(proxy => {
        if (!proxy?.name) return false;
        if (!seen.has(proxy.name)) {
          seen.set(proxy.name, true);
          return true;
        }
        return false;
      });

      // 5. 更新PROXY组
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

    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(fixedConfig));

  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

module.exports = app;
