const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  // 使用 'Clash' 作为 User-Agent 可能有更好的兼容性
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash' } });
  return yaml.load(response.data);
}

// 修改1: 将路由从 app.get('/') 修改为 app.get('/*')
// 这将捕获域名后的所有路径
app.get('/*', async (req, res) => {
  // 修改2: 从 req.url 获取订阅链接，并去掉开头的 '/'
  // 例如, 请求 "https://your-domain.com/https://example.com/sub"
  // req.url 会是 "/https://example.com/sub"
  // .slice(1) 后就得到了 "https://example.com/sub"
  const subUrl = req.url.slice(1);

  // 修改3: 优化了入口判断逻辑
  // 如果 subUrl 为空 (访问根目录) 或浏览器请求图标，则返回使用说明
  if (!subUrl || subUrl === 'favicon.ico') {
    const host = req.get('host');
    const protocol = req.protocol;
    return res.status(400).send(
      `请直接在域名后拼接订阅链接使用。\n\n例如: ${protocol}://${host}/你的订阅地址`
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
    // 使用 'Clash' 作为 User-Agent 可能有更好的兼容性
    const response = await axios.get(subUrl, { headers: { 'User-Agent': 'Clash' } });
    let decodedData = response.data;
    
    // Base64解码处理
    try {
      // 优化了Base64判断，更健壮
      const tempDecoded = Buffer.from(decodedData, 'base64').toString('utf-8');
      // 检查解码后的内容是否像一个配置文件
      if (tempDecoded.includes('proxies:') || tempDecoded.includes('proxy-groups:') || tempDecoded.includes('rules:')) {
        decodedData = tempDecoded;
      }
    } catch (e) {
      // 解码失败，说明本身不是 Base64，忽略错误，继续使用原始数据
    }

    // 解析订阅数据
    let subConfig;
    if (decodedData.includes('proxies:')) {
      subConfig = yaml.load(decodedData);
    } else {
      // 你的自定义格式解析逻辑，这里保持不变
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
          ...templateProxies[0],  // 保留名称和默认配置
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
            // 保留原有名称顺序，实际连接已更新
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
    // 优化了错误返回信息，对用户更友好
    console.error('Error processing subscription:', error); // 在服务端打印详细错误
    res.status(500).send(`处理订阅链接时发生错误。\n请检查链接是否正确: ${subUrl}\n错误详情: ${error.message}`);
  }
});

module.exports = app;
