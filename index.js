const express = require('express');
const axios = require('axios');
const yaml = require('js-yaml');
const app = express();

const FIXED_CONFIG_URL = 'https://raw.githubusercontent.com/l3oku/clashrule-lucy/refs/heads/main/Mihomo.yaml';

// 用正则提取“服务器-端口”，构造归一化的标识
function normalizeName(name) {
  // 匹配形如 "server-port" 或 "server port" 的格式
  const match = name.match(/^([^-\s]+)[-\s]*(\d+)$/);
  if (match) {
    return match[1].toLowerCase() + ':' + match[2];
  }
  return name.replace(/\s+/g, '').toLowerCase();
}

// 归一化后去重
function dedupeNames(names) {
  const seen = new Set();
  const result = [];
  names.forEach(name => {
    const normalized = normalizeName(name);
    if (!seen.has(normalized)) {
      seen.add(normalized);
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
    
    // 4. 根据数据内容判断：如果包含 proxies 或 port，则认为是标准 YAML 配置
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
      // 5. 如果不符合 YAML 格式，则尝试解析为自定义格式（假设每行一个节点，字段用 | 分隔）
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
    
    // 6. 将订阅数据中的代理列表嫁接到固定模板中
    if (subConfig && subConfig.proxies && subConfig.proxies.length > 0) {
      const subProxyNames = subConfig.proxies.map(p => p.name);
      
      // 合并固定模板中的 proxies 和订阅的 proxies，避免重复（归一化后根据 name 去重）
      if (fixedConfig.proxies && Array.isArray(fixedConfig.proxies)) {
        const existingProxiesMap = {};
        fixedConfig.proxies.forEach(proxy => {
          const normalized = normalizeName(proxy.name);
          existingProxiesMap[normalized] = proxy;
        });
        subConfig.proxies.forEach(proxy => {
          const normalized = normalizeName(proxy.name);
          existingProxiesMap[normalized] = proxy;
        });
        fixedConfig.proxies = Object.values(existingProxiesMap);
      } else {
        fixedConfig.proxies = subConfig.proxies;
      }
      
      // 更新 proxy-groups 中的代理名称列表
      if (fixedConfig['proxy-groups']) {
        fixedConfig['proxy-groups'] = fixedConfig['proxy-groups'].map(group => {
          if (group.proxies && Array.isArray(group.proxies)) {
            // 针对“手动策略”组，过滤掉已经存在的订阅节点（归一化对比）
            if (group.name === '手动策略') {
              const manualNodes = group.proxies;
              const manualSet = new Set(manualNodes.map(normalizeName));
              // 只保留那些不在手动配置中的订阅节点
              const newSubNodes = subProxyNames.filter(name => !manualSet.has(normalizeName(name)));
              const merged = dedupeNames([...manualNodes, ...newSubNodes]);
              return { ...group, proxies: merged };
            } else {
              // 其他分组直接替换为订阅节点
              return { ...group, proxies: subProxyNames };
            }
          }
          return group;
        });
      }
    }
    
    // ★★ 关键：移除 proxy-providers，避免 ClashMeta 再次加载重复订阅节点 ★★
    if (fixedConfig['proxy-providers']) {
      delete fixedConfig['proxy-providers'];
    }
    
    // 7. 输出最终的 YAML 配置
    res.set('Content-Type', 'text/yaml');
    res.send(yaml.dump(fixedConfig));
  } catch (error) {
    res.status(500).send(`转换失败：${error.message}`);
  }
});

module.exports = app;
