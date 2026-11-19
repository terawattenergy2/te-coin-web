// Restricted arithmetic grammar; deliberately never runs eval, Function or SQL expressions.
export const formulaLabels = {
  commission_amount: "คอมมิชชันต่อหน่วย",
  gross_margin: "Gross Margin ต่อหน่วย",
  earned_tc: "TC ที่ได้รับจากการขาย",
  reward_tc_1: "TC แลก Bundle Set",
  reward_tc_2: "TC แลก Cashback / Voucher",
  reward_tc_3: "TC ต่อครั้ง Lucky Draw",
  reward_tc_4: "TC แลกทัวร์",
  tc_value: "มูลค่าแต้มคงเหลือ (บาท)",
  liability_amount: "Liability (บาท)",
  lucky_rate: "โอกาสได้รับ Lucky Draw (0–1)",
};
export const defaultExpressions = {
  commission_amount: "sale_unit_price * commission_rate",
  gross_margin: "sale_unit_price - base_cost - commission_amount",
  earned_tc: "round(max(0, gross_margin * quantity * group_multiplier), 2)",
  reward_tc_1: "ceil(value_baht * redemption_b * 100) / 100",
  reward_tc_2: "ceil(value_baht * redemption_b * 100) / 100",
  reward_tc_3: "ceil(value_baht * redemption_b * 100) / 100",
  reward_tc_4: "ceil(value_baht * redemption_b * 100) / 100",
  tc_value: "balance_tc * baht_per_tc",
  liability_amount: "tc_value",
  lucky_rate: "success_rate",
};
const arity = {
  abs: [1, 1],
  ceil: [1, 1],
  floor: [1, 1],
  round: [1, 2],
  min: [2, 8],
  max: [2, 8],
};
export function parseFormula(source) {
  if (typeof source !== "string" || !source.trim() || source.length > 2000)
    throw Error("สูตรต้องมีความยาว 1–2000 ตัวอักษร");
  const tokens = [];
  let pos = 0;
  while (pos < source.length) {
    const tail = source.slice(pos);
    const m =
      /^(\s+|\d+(?:\.\d+)?|\.\d+|[A-Za-z_][A-Za-z_0-9]*|[+\-*/(),])/.exec(tail);
    if (!m) throw Error(`สัญลักษณ์ไม่ถูกต้องที่ตำแหน่ง ${pos + 1}`);
    pos += m[0].length;
    if (m[0].trim()) tokens.push(m[0]);
  }
  if (tokens.length > 256) throw Error("สูตรซับซ้อนเกินไป");
  let i = 0,
    depth = 0;
  function atom() {
    if (++depth > 32) throw Error("วงเล็บซ้อนเกิน 32 ชั้น");
    const t = tokens[i++];
    let result;
    if (t === "+" || t === "-")
      result = { op: t === "-" ? "neg" : "pos", args: [atom()] };
    else if (t === "(") {
      result = expr();
      if (tokens[i++] !== ")") throw Error("วงเล็บปิดไม่ครบ");
    } else if (t && /^(?:\d|\.)/.test(t)) {
      if (!Number.isFinite(Number(t))) throw Error("ตัวเลขมากเกินไป");
      result = { value: t };
    } else if (t && /^[A-Za-z_]/.test(t)) {
      if (tokens[i] === "(") {
        if (!arity[t]) throw Error(`ไม่รองรับฟังก์ชัน ${t}`);
        i++;
        const args = [expr()];
        while (tokens[i] === ",") {
          i++;
          args.push(expr());
        }
        if (tokens[i++] !== ")") throw Error("วงเล็บฟังก์ชันไม่ครบ");
        if (args.length < arity[t][0] || args.length > arity[t][1])
          throw Error(`จำนวนอาร์กิวเมนต์ของ ${t} ไม่ถูกต้อง`);
        result = { op: t, args };
      } else result = { var: t };
    } else throw Error("ต้องระบุตัวเลข ตัวแปร หรือวงเล็บ");
    depth--;
    return result;
  }
  function term() {
    let n = atom();
    while (tokens[i] === "*" || tokens[i] === "/") {
      const op = tokens[i++];
      n = { op: op === "*" ? "mul" : "div", args: [n, atom()] };
    }
    return n;
  }
  function expr() {
    let n = term();
    while (tokens[i] === "+" || tokens[i] === "-") {
      const op = tokens[i++];
      n = { op: op === "+" ? "add" : "sub", args: [n, term()] };
    }
    return n;
  }
  const result = expr();
  if (i !== tokens.length) throw Error("รูปแบบสูตรไม่ถูกต้อง");
  return result;
}
export function printFormula(node) {
  if (Object.prototype.hasOwnProperty.call(node, "value"))
    return String(node.value);
  if (node.var) return node.var;
  const a = node.args.map(printFormula),
    symbol = { add: "+", sub: "-", mul: "*", div: "/" }[node.op];
  if (symbol) return `(${a[0]} ${symbol} ${a[1]})`;
  if (node.op === "neg" || node.op === "pos")
    return `${node.op === "neg" ? "-" : "+"}(${a[0]})`;
  return `${node.op}(${a.join(", ")})`;
}
export function formulaRules(settings) {
  return {
    ...Object.fromEntries(
      Object.entries(defaultExpressions).map(([k, v]) => [k, parseFormula(v)]),
    ),
    ...(settings?.formulas || {}),
  };
}
export function evaluateTarget(target, rules, context, stack = [], memo = {}) {
  if (Object.prototype.hasOwnProperty.call(memo, target)) return memo[target];
  if (stack.length > 64 || stack.includes(target))
    throw Error(`สูตรอ้างอิงวนซ้ำ: ${[...stack, target].join(" → ")}`);
  if (!Object.prototype.hasOwnProperty.call(rules, target)) {
    if (
      !Object.prototype.hasOwnProperty.call(context, target) ||
      context[target] === null ||
      context[target] === ""
    )
      throw Error(`ไม่พบค่าตัวแปร ${target}`);
    const value = Number(context[target]);
    if (!Number.isFinite(value)) throw Error(`ตัวแปร ${target} ไม่ใช่ตัวเลข`);
    return value;
  }
  const next = [...stack, target];
  function evaluate(n, depth = 0) {
    if (depth > 32) throw Error("สูตรซ้อนลึกเกินไป");
    if (Object.prototype.hasOwnProperty.call(n, "value"))
      return Number(n.value);
    if (n.var) return evaluateTarget(n.var, rules, context, next, memo);
    const a = n.args.map((v) => evaluate(v, depth + 1));
    let v;
    switch (n.op) {
      case "add":
        v = a[0] + a[1];
        break;
      case "sub":
        v = a[0] - a[1];
        break;
      case "mul":
        v = a[0] * a[1];
        break;
      case "div":
        if (a[1] === 0) throw Error("ไม่สามารถหารด้วยศูนย์");
        v = a[0] / a[1];
        break;
      case "neg":
        v = -a[0];
        break;
      case "pos":
        v = a[0];
        break;
      case "abs":
        v = Math.abs(a[0]);
        break;
      case "min":
        v = Math.min(...a);
        break;
      case "max":
        v = Math.max(...a);
        break;
      case "ceil":
        v = Math.ceil(a[0]);
        break;
      case "floor":
        v = Math.floor(a[0]);
        break;
      case "round": {
        const d = a[1] ?? 0;
        if (!Number.isInteger(d) || d < 0 || d > 8)
          throw Error("ทศนิยมต้องเป็นจำนวนเต็ม 0–8");
        v = round(a[0], d);
        break;
      }
      default:
        throw Error("ตัวดำเนินการไม่ถูกต้อง");
    }
    if (!Number.isFinite(v) || Math.abs(v) > 1e15)
      throw Error("ผลลัพธ์เกินขอบเขต");
    return v;
  }
  const result = evaluate(rules[target]);
  memo[target] = result;
  return result;
}
export const round = (v, d = 2) =>
  (Math.sign(v) * Math.round((Math.abs(v) + Number.EPSILON) * 10 ** d)) /
  10 ** d;
export function formulaContext(product = {}, settings = {}, extra = {}) {
  const raw = {};
  for (const [k, v] of Object.entries(product))
    if (
      v !== null &&
      v !== "" &&
      typeof v !== "boolean" &&
      Number.isFinite(Number(String(v).replace(/,/g, "")))
    ) {
      raw[k] = Number(String(v).replace(/,/g, ""));
      raw[`raw_${k}`] = raw[k];
    }
  return {
    ...raw,
    quantity: 1,
    sale_unit_price: Number(String(product.epc_price ?? 0).replace(/,/g,"")),
    base_cost: Number(String(product[settings.membership_config?.base_cost_column || "tier_2_price"] ?? 0).replace(/,/g,"")),
    group_multiplier: Number(settings.membership_config?.groups?.[product.product]?.b ?? settings.y ?? 0.5),
    redemption_d: 1,
    redemption_b: 1,
    y: Number(settings.y ?? 0.5),
    commission_rate: Number(settings.membership_config?.groups?.[product.product]?.commission ?? settings.commission ?? 0.015),
    baht_per_tc: Number(settings.baht_per_tc ?? 0.6),
    success_rate: Number(settings.success_rate ?? 0.8),
    value_baht: 800,
    reward_y: 1,
    balance_tc: 24500,
    total_earn: 32000,
    used_tc: 7500,
    ...extra,
  };
}
export function resultFor(target, settings, context) {
  return evaluateTarget(target, formulaRules(settings), context);
}
export function customerMetric(target, customer, settings) {
  return round(
    resultFor(
      target,
      settings,
      formulaContext({}, settings, {
        balance_tc: Number(customer?.banlance_tc || 0),
        total_earn: Number(customer?.total_earn || 0),
        used_tc: Number(customer?.used_tc || 0),
      }),
    ),
    2,
  );
}
export function computedProduct(product, settings) {
  const p = { ...product };
  const rules = formulaRules(settings),
    context = formulaContext(product, settings);
  for (const key of Object.keys(settings?.formulas || {}))
    if (!formulaLabels[key]) p[key] = evaluateTarget(key, rules, context);
  return p;
}
