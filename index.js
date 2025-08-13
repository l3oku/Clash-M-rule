const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash Verge' } });
  return yaml.load(response.data);
}

// 修改点 1: 将路由从 app.get('/') 修改为 app.get('/*')
// 这将捕获根路径 (/) 之后的所有内容作为路径参数
app.get('/*', async (req, res) => {
  // 修改点 2: 从请求路径 (req.path) 中提取订阅链接
  // req.path 会获取到类似 '/https://...' 的字符串
  const path = req.path;

  // 如果用户只访问根域名，没有提供任何订阅链接，则返回提示
  if (path === '/') {
    return res.status(400).send('请在域名后直接拼接订阅链接，例如 /https://你的订阅地址');
  }

  // 修改点 3: 去掉路径开头的 '/', 得到真实的订阅链接
  const subUrl = path.substring(1);

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
