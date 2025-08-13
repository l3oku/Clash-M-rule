const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash' } });
  return yaml.load(response.data);
}

// 唯一的主要改动在这里：捕获所有路径，并从路径中提取URL
app.get('/*', async (req, res) => {
  // 从 req.url 获取订阅链接 (例如 /https%3A%2F%2F... )，并去掉开头的 '/'
  const subUrl = req.url.slice(1);

  if (!subUrl || subUrl === 'favicon.ico') {
    const host = req.get('host');
    const protocol = req.protocol;
    return res.status(400).send(
      `请对你的订阅链接进行URL编码后，再拼接到域名后面使用。\n\n例如: ${protocol}://${host}/编码后的订阅地址`
    );
  }

  try {
    // ======================================================================
    // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
    //
    //              您原有的核心逻辑从这里开始，完全没有改动
    //
    // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
    // ======================================================================

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

    // 核心逻辑：混合模板与订阅代理
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
    
    // ======================================================================
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    //
    //              您原有的核心逻辑到这里结束，完全没有改动
    //
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
    // ======================================================================

    res.set('Content-Type', 'text/yaml; charset=utf-8');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    console.error('Error processing subscription:', error);
    res.status(500).send(`处理订阅链接时发生错误。\n请检查编码后的链接是否正确。\n原始链接(解码后): ${decodeURIComponent(subUrl)}\n错误详情: ${error.message}`);
  }
});

module.exports = app;
