'use strict';
/**
 * GET /agent/unmodel/:cube——27 文档 §5/#4：未建模清单，纯读
 * conf/unmodel/<cube>.json（原 CLI unmodel.js survey 的存档形态，
 * schema unmodeled-inventory/1）；未建册返回"未盘点"结构。
 * cube 名做白名单净化，防路径穿越。
 */

const fs = require('fs');

const UNMODEL_DIR = process.env.AGENT_API_UNMODEL_DIR || '/cube/conf/unmodel';

async function run(params) {
  const cube = params[0];
  if (!/^[A-Za-z0-9_-]+$/.test(cube)) {
    throw { httpStatus: 400, error: 'invalid_name', message: 'cube 名只允许字母/数字/下划线/中划线' };
  }

  const file = `${UNMODEL_DIR}/${cube}.json`;
  if (!fs.existsSync(file)) {
    return {
      schema: 'unmodeled-inventory/1',
      cube,
      status: '未盘点',
      message: `conf/unmodel/${cube}.json 不存在——该主题尚未做未建模盘点，无法回答"还差什么数据"，只能以"模型里没有"作答并注明未盘点`,
      inventories: [],
    };
  }

  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw { httpStatus: 500, error: 'inventory_unreadable', message: `盘点册损坏: ${e.message}` };
  }
  return doc;
}

module.exports = { run };
