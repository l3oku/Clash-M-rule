const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://gh.ikuu.eu.org/https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

async function loadYaml(url) {
  const response = await axios.get(url, { headers: { 'User-Agent': 'Clash' } });
  return yaml.load(response.data);
}

app.get('/*', async (req, res) => {
  // ====================== 调试日志开始 ======================
  console.log('\n\n--- [STEP 1] INCOMING REQUEST ---');
  console.log(`Raw URL from client (req.originalUrl): ${req.originalUrl}`);
  // =========================================================

  // Clash客户端或浏览器可能会自动编码URL，所以我们必须解码
  // 这是一个非常关键的步骤，很可能是之前失败的原因
  let subUrl;
  try {
      subUrl = decodeURIComponent(req.originalUrl.slice(1));
  } catch (e) {
      // 如果解码失败，说明URL可能没被编码，直接使用
      subUrl = req.originalUrl.slice(1);
  }
  
  // ====================== 调试日志 ======================
  console.log(`--- [STEP 2] PROCESSED SUBSCRIPTION URL ---`);
  console.log(`Decoded URL to be fetched: ${subUrl}`);
  // =========================================================

  if (!subUrl || subUrl === 'favicon.ico') {
    return res.status(400).send('请在域名后直接拼接订阅链接。');
  }
  
  try {
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);
    if (!Array.isArray(fixedConfig.proxies)) {
      fixedConfig.proxies = [];
    }

    // ====================== 调试日志 ======================
    console.log('--- [STEP 3] FETCHING SUBSCRIPTION CONTENT ---');
    // =========================================================
    const response = await axios.get(subUrl, { headers: { 'User-Agent': 'Clash' } });
    let decodedData = response.data;

    // ====================== 调试日志 ======================
    console.log('--- [STEP 4] RECEIVED SUBSCRIPTION CONTENT ---');
    console.log('Data type:', typeof decodedData);
    // 只打印前300个字符，避免刷屏和泄露过多信息
    console.log('Data (first 300 chars):', String(decodedData).substring(0, 300));
    // =========================================================
    
    // Base64解码处理
    try {
      const tempDecoded = Buffer.from(decodedData, 'base64').toString('utf-8');
      if (tempDecoded.includes('proxies:') || tempDecoded.includes('proxy-groups:') || tempDecoded.includes('rules:')) {
        decodedData = tempDecoded;
        // ====================== 调试日志 ======================
        console.log('--- [STEP 4.1] DECODED FROM BASE64 ---');
        console.log('Decoded Data (first 300 chars):', decodedData.substring(0, 300));
        // =========================================================
      }
    } catch (e) {}

    // 解析订阅数据
    let subConfig;
    if (decodedData.includes('proxies:')) {
      subConfig = yaml.load(decodedData);
    } else {
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

    // ====================== 调试日志 ======================
    console.log('--- [STEP 5] PARSING RESULT ---');
    const proxyCount = subConfig?.proxies?.length || 0;
    console.log(`Number of proxies found in subscription: ${proxyCount}`);
    if (proxyCount > 0) {
        console.log('First proxy found:', JSON.stringify(subConfig.proxies[0]));
    }
    // =========================================================

    // 核心逻辑
    if (proxyCount > 0) {
      const templateProxies = [...fixedConfig.proxies];
      if (templateProxies.length > 0) {
        const subProxy = subConfig.proxies[0];
        templateProxies[0] = { ...templateProxies[0], ...subProxy }; // 简化合并逻辑
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
              proxies: group.proxies.filter(name => fixedConfig.proxies.some(p => p.name === name))
            };
          }
          return group;
        });
      }
    }

    // ====================== 调试日志 ======================
    console.log('--- [STEP 6] FINAL RESULT ---');
    console.log(`Total proxies after merging: ${fixedConfig.proxies.length}`);
    // =========================================================

    res.set('Content-Type', 'text/yaml; charset=utf-8');
    res.send(yaml.dump(fixedConfig));

  } catch (error) {
    // ====================== 调试日志 ======================
    console.error('--- [ERROR] AN EXCEPTION OCCURRED ---');
    console.error(error);
    // =========================================================
    res.status(500).send(`处理订阅链接时发生错误。\n请检查服务器日志获取详情。\n错误: ${error.message}`);
  }
});

module.exports = app;
