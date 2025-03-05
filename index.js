const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

// 用正则移除常见 emoji，并归一化节点名称
function canonicalizeName(name) {
  if (!name) return '';
  // 移除 emoji（涵盖常见区间：U+1F300-U+1F6FF 和 U+1F1E6-U+1F1FF）
  let canonical = name.replace(/[\u{1F300}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}]/gu, '');
  // 移除所有空白字符
  canonical = canonical.replace(/\s+/g, '');
  // 移除连字符和破折号（防止因标点不同而被认为不同）
  canonical = canonical.replace(/[-—]/g, '');
  // 转为小写
  canonical = canonical.toLowerCase();
  return canonical;
}

// 归一化后去重：传入的名称数组会先做 canonicalizeName 再比对
function dedupeNames(names) {
  const seen = new Set();
  const result = [];
  names.forEach(name => {
    const key = canonicalizeName(name);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(name);
    }
  });
  return result;
}

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
    // 1. 加载固定 YAML 配置作为模板
    const fixedConfig = await loadYaml(FIXED_CONFIG_URL);
    
    // 2. 从订阅链接获取原始数据
    const response = await axios.get(subUrl, {
      headers: { 'User-Agent': 'Clash Verge' }
    });
    const rawData = response.data;

    // 3. 尝试 Base64 解码（如果传入的数据经过编码）
    let decodedData;
    try {
      decodedData = Buffer.from(rawData, 'base64').toString('utf-8');
      // 如果解码后数据中不含关键字，则认为原始数据就是明文
      if (!decodedData.includes('proxies:') && 
          !decodedData.includes('port:') && 
          !decodedData.includes('mixed-port:')) {
        decodedData = rawData;
      }
    } catch (e) {
      decodedData = rawData;
    }
    
    // 4. 判断数据格式：如果包含 proxies 或 port，则认为是 YAML 配置
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
      // 5. 如果不是 YAML 格式，则尝试按自定义格式解析（每行一个节点，字段用 | 分隔）
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
    
    // 6. 合并订阅节点到固定模板中
    if (subConfig && subConfig.proxies && subConfig.proxies.length > 0) {
      const subProxyNames = subConfig.proxies.map(p => p.name);
      
      // 合并 fixedConfig.proxies 和订阅的 proxies，使用 canonicalizeName 进行归一化去重
      if (fixedConfig.proxies && Array.isArray(fixedConfig.proxies)) {
        const proxyMap = {};
        fixedConfig.proxies.forEach(proxy => {
          const key = canonicalizeName(proxy.name);
          proxyMap[key] = proxy;
        });
        subConfig.proxies.forEach(proxy => {
          const key = canonicalizeName(proxy.name);
          proxyMap[key] = proxy;
        });
        fixedConfig.proxies = Object.values(proxyMap);
      } else {
        fixedConfig.proxies = subConfig.proxies;
      }
      
      // 更新 proxy-groups 中的代理名称列表
      if (fixedConfig['proxy-groups']) {
        fixedConfig['proxy-groups'] = fixedConfig['proxy-groups'].map(group => {
          if (group.proxies && Array.isArray(group.proxies)) {
            // 针对“手动切换”组（注意保持与固定模板一致）
            if (group.name === '手动切换') {
              const manualNodes = group.proxies;
              const manualSet = new Set(manualNodes.map(canonicalizeName));
              // 过滤订阅节点中已存在的（归一化后判断）
              const newSubNodes = subProxyNames.filter(name => !manualSet.has(canonicalizeName(name)));
              const merged = dedupeNames([...manualNodes, ...newSubNodes]);
              return { ...group, proxies: merged };
            } else {
              // 其他分组直接使用订阅节点
              return { ...group, proxies: subProxyNames };
            }
          }
          return group;
        });
      }
    }
    
    // ★★ 移除 proxy-providers（确保 ClashMeta 不会二次加载订阅节点） ★★
    if (fixedConfig['proxy-providers']) {
      delete fixedConfig['proxy-providers'];
    }
    
    // 7. 输出最终 YAML 配置
    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

module.exports = app;
