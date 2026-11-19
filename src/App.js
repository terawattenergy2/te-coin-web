import React, { useEffect, useState } from "react";
import "./App.css";
import "./Theme.css";
import StockTable from "./StockTable";
import { stockHeader } from "./stockHeaders";
import CustomerCatalog from "./CustomerCatalog";
import UserAccess from "./UserAccess";
import RewardEditor from "./RewardEditor";
import RewardDetails from "./RewardDetails";
import FormulaEditor from "./FormulaEditor";
import SettingsFields from "./SettingsFields";
import SaleForm from "./SaleForm";
import SalesReview from "./SalesReview";
import { createRequestId } from "./requestId";
import FlowAccountDocuments from "./FlowAccountDocuments";
import FlowAccountPanel from "./FlowAccountPanel";
import FlowAccountCustomer from "./FlowAccountCustomer";
import EpcRegistration from "./EpcRegistration";
import EpcApprovals from "./EpcApprovals";
import AdminTeamSignup from "./AdminTeamSignup";
import Login from "./AuthScreen";
import "./AuthScreen.css";
import "./CompanyPage.css";
import "./Terawatt.css";
import FormulaSummary from "./FormulaSummary";
import { customerMetric } from "./formulas";
import { api, connected, setSession, restoreSession } from "./api";
import {
  defaults,
  initialProducts,
  initialRewards,
  calculate,
  rewardB,
  rewardCost,
  luckyProbability,
  number,
} from "./coin";
const fmt = (v) =>
  number(v).toLocaleString("th-TH", { maximumFractionDigits: 2 });
const labels = [
  "ภาพรวม",
  "แลกรางวัล",
  "ประวัติรายการ",
  "สินค้าและราคา",
  "บันทึกยอดขาย",
  "ตั้งค่าระบบ",
  "ผู้ใช้งาน",
  "FlowAccount / EPC",
];
const salesReviewPage = 10;
const salesReviewTitle = "ยอดขายตามเซลส์";
const privatePilot = process.env.REACT_APP_PRIVATE_PILOT === "1";
const offlineMessage = "ไม่มีการเชื่อมต่ออินเทอร์เน็ต กรุณาเชื่อมต่อก่อนโหลดข้อมูลหรือบันทึกรายการ";
const navigationGroups = [
  { id: "sales", label: "งานขาย", pages: [4, 9, salesReviewPage] },
  { id: "admin", label: "จัดการระบบ", pages: [5, 6, 7] },
];

function Navigation({ page, admin, demo, awaitingEpcApproval, onNavigate }) {
  const [openGroup, setOpenGroup] = useState(null);
  const labelFor = (id) => id === 9 ? "เอกสารขาย" : id === salesReviewPage ? salesReviewTitle : labels[id];

  function pageButton(id) {
    return (
      <button
        type="button"
        key={id}
        className={page === id ? "active" : ""}
        aria-current={page === id ? "page" : undefined}
        onClick={() => {
          const trigger = document.getElementById("nav-trigger-" + openGroup);
          setOpenGroup(null);
          trigger?.focus();
          onNavigate(id);
        }}
      >
        {labelFor(id)}
      </button>
    );
  }

  return (
    <nav aria-label="เมนูหลัก">
      {!awaitingEpcApproval && [0, 1, 2, 3].map(pageButton)}
      {admin && navigationGroups.map(({ id, label, pages }) => {
        const expanded = openGroup === id;
        return (
          <div
            key={id}
            className="nav-group"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                setOpenGroup((current) => current === id ? null : current);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && expanded) {
                setOpenGroup(null);
                event.currentTarget.querySelector("button").focus();
              }
            }}
          >
            <button
              type="button"
              id={"nav-trigger-" + id}
              className={pages.includes(page) || expanded ? "active nav-group-trigger" : "nav-group-trigger"}
              aria-expanded={expanded}
              onClick={() => setOpenGroup(expanded ? null : id)}
            >
              {label}
            </button>
            {expanded && (
              <div className="nav-group-panel">
                {pages.filter((item) => item !== salesReviewPage || !demo).map(pageButton)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
function sandboxCustomerIds(customers, links) {
  const sandbox = new Set(links.filter(link => link.environment === "test").map(link => link.customer_id));
  const production = new Set(links.filter(link => link.environment === "v1").map(link => link.customer_id));
  const identity = customer => String(customer.customer_name || "").normalize("NFKC").trim();
  const sandboxNames = new Set(customers.filter(customer => sandbox.has(customer.customer_id)).map(identity).filter(Boolean));
  const productionNames = new Set(customers.filter(customer => production.has(customer.customer_id)).map(identity));
  return new Set(customers.filter(customer => {
    const id = customer.customer_id;
    return !production.has(id) && (sandbox.has(id) ||
      (sandboxNames.has(identity(customer)) && !productionNames.has(identity(customer))));
  }).map(customer => customer.customer_id));
}

export default function App() {
  const [settingsSection, setSettingsSection] = useState("accrual");
  const [registrationSuccess, setRegistrationSuccess] = useState(null);
  const [selectedReward, setSelectedReward] = useState(null);
  const [user, setUser] = useState(null),
    [role, setRole] = useState("customer"),
    [selectedPage, setPage] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [settings, setSettings] = useState(defaults),
    [products, setProducts] = useState([]),
    [rewards, setRewards] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stockStatus, setStockStatus] = useState("idle"),
    [stockError, setStockError] = useState("");
  const [ledger, setLedger] = useState([]),
    [profiles, setProfiles] = useState([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  const [editProduct, setEditProduct] = useState(null),
    [editReward, setEditReward] = useState(null);
  const [epcRequest, setEpcRequest] = useState(null);
  const [ownProfile, setOwnProfile] = useState(null),
    [priceColumns, setPriceColumns] = useState(["tier_2_price", "epc_price"]);

  const membershipReady = user?.demo || settings.membership_version === 2;
  const redemptionReady = user?.demo || Boolean(settings.formulas);
  const rewardBReady = user?.demo || settings.reward_formula_version === 1;
  const demo = user?.demo,
    admin = role === "admin",
    staff = admin || role === "viewer";
  const awaitingEpcApproval = privatePilot && !demo && !staff && epcRequest?.status !== "approved";
  const page = awaitingEpcApproval ? 8 : selectedPage;

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);
  function clearAccountData() {
    setEpcRequest(null);
    setSettings({ ...defaults, membership_version: 1 });
    setStockStatus("idle");
    setStockError("");
    setProducts([]);
    setCustomers([]);
    setLedger([]);
    setProfiles([]);
    setRewards([]);
    setOwnProfile(null);
    setRole("customer");
  }
  async function refreshProducts(isStaff) {
    setStockStatus("loading");
    setStockError("");
    try {
      const rows = isStaff
        ? await api.readAll("stock_profit")
        : await api.catalog();
      setProducts(rows);
      setStockStatus("loaded");
      return rows;
    } catch (e) {
      setProducts([]);
      setStockStatus("error");
      setStockError(e.message);
      throw e;
    }
  }
  async function connectLive() {
    const saved = restoreSession();
    if (saved) {
      const real = await api.me();
      clearAccountData();
      setUser(real);
      setPage(3);
      return;
    }
    clearAccountData();
    setUser(null);
    setPage(0);
    setMessage("กรุณาเข้าสู่ระบบด้วยบัญชีจริงเพื่อโหลดสินค้าจาก Supabase");
  }
  async function load(u = user) {
    if (!u || u.demo) return;
    const pr = await api.read("tc_profiles");
    const profile = pr.find((v) => v.id === u.id);
    if (!profile) {
      setSession(null);
      setUser(null);
      clearAccountData();
      setPage(0);
      setMessage("บัญชีนี้ไม่อยู่ในระบบแล้ว กรุณาสมัครใหม่หรือติดต่อผู้ดูแล");
      return;
    }
    if (profile.account_status && profile.account_status !== "active") {
      setSession(null);
      setUser(null);
      clearAccountData();
      setPage(0);
      setMessage(
        profile.account_status === "suspended"
          ? "บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแล"
          : "บัญชีนี้ถูกลบออกจากระบบแล้ว กรุณาติดต่อผู้ดูแล",
      );
      return;
    }
    setProfiles(pr);
    setOwnProfile(profile);
    setRole(profile.role);
    const isStaff = ["admin", "viewer"].includes(profile.role);
    await refreshProducts(isStaff);
    if (profile.role === "admin")
      setPriceColumns(
        (await api.rpc("tc_price_columns", {})).map((c) => c.column_name),
      );
    const [s, r, c, l, links] = await Promise.all(
      [
        ...["tc_settings", "tc_rewards", "tera_coin_customer", "tc_ledger"].map(
          table => api.read(table),
        ),
        isStaff ? api.read("tc_flow_epcs") : [],
      ],
    );
    setSettings(s[0] || defaults);
    setRewards(r);
    const hiddenCustomers = sandboxCustomerIds(c, links || []);
    const hiddenProfiles = new Set(c.filter(customer => hiddenCustomers.has(customer.customer_id))
      .map(customer => customer.auth_user_id).filter(Boolean));
    const visibleProfiles = pr.filter(item => !hiddenProfiles.has(item.id));
    setCustomers(c.filter(customer => !hiddenCustomers.has(customer.customer_id)));
    setLedger(l.filter(entry => !hiddenCustomers.has(entry.customer_id)));
    if (profile.role === "admin") {
      const events = await api.read("tc_account_events");
      const archived = events
        .filter(
          (e) =>
            e.operation === "delete" && !hiddenProfiles.has(e.profile_id) &&
            !pr.some((p) => p.id === e.profile_id),
        )
        .map((e) => ({
          ...e.account_snapshot?.profile,
          id: e.profile_id,
          role: "customer",
          customer_name:
            e.account_snapshot?.profile?.customer_name || "บัญชีที่ลบแล้ว",
          account_status: "deleted",
          account_updated_at: e.created_at,
        }));
      setProfiles([...visibleProfiles, ...archived]);
    }
    if (profile.role === "customer") {
      const requests = await api.read("tc_epc_requests");
      setEpcRequest(requests.find((r) => r.profile_id === u.id) || null);
    }
  }
  useEffect(() => {
    const saved = restoreSession();
    if (saved)
      api
        .me()
        .then((u) => {
          clearAccountData();
          setUser(u);
        })
        .catch((error) => {
          if ([400, 401, 403].includes(error.status)) setSession(null);
          else setMessage("เชื่อมต่อไม่ได้ชั่วคราว กรุณาโหลดหน้าเว็บใหม่เมื่ออินเทอร์เน็ตพร้อม");
        });
  }, []);
  useEffect(() => {
    if (user && !user.demo) {
      setBusy(true);
      load(user)
        .catch((e) => setMessage(e.message))
        .finally(() => setBusy(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);
  useEffect(() => {
    if (!user || user.demo) return;
    const timer = setInterval(() => {
      api
        .read("tc_profiles")
        .then((rows) => {
          const p = rows.find((p) => p.id === user.id);
          if (!p || (p.account_status && p.account_status !== "active")) {
            setSession(null);
            setUser(null);
            clearAccountData();
            setPage(0);
            setMessage(
              p?.account_status === "suspended"
                ? "บัญชีนี้ถูกระงับ กรุณาติดต่อผู้ดูแล"
                : "บัญชีนี้ถูกลบออกจากระบบแล้ว กรุณาติดต่อผู้ดูแล",
            );
          }
        })
        .catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [user]);
  async function action(fn, reload = true) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      if (!demo && reload) await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  const customer =
    customers.find((c) => c.auth_user_id === user?.id) ||
    (demo ? customers[0] : null);
  const balance = staff
    ? customers.reduce((a, c) => a + number(c.banlance_tc), 0)
    : number(customer?.banlance_tc);
  const liability = staff
    ? customers.reduce(
        (sum, c) => sum + customerMetric("liability_amount", c, settings),
        0,
      )
    : customerMetric("liability_amount", customer, settings);
  const tcValue = staff
    ? customers.reduce(
        (sum, c) => sum + customerMetric("tc_value", c, settings),
        0,
      )
    : customerMetric("tc_value", customer, settings);
  function demoLogin(r) {
    setSettings(defaults);
    setProducts(
      r === "customer"
        ? initialProducts.map((p) => ({
            id: p.id,
            model: p.model,
            main: p.main,
            product: p.product,
            qty: p.Qty,
            unit_price: p.epc_price,
            price_tier: "epc_price",
          }))
        : initialProducts,
    );
    setCustomers([
      {
        customer_id: "demo-customer",
        customer_name: "บริษัท พลังงานตัวอย่าง จำกัด",
        total_earn: 32000,
        used_tc: 7500,
        banlance_tc: 24500,
      },
    ]);
    setRewards(initialRewards);
    setOwnProfile({ price_column: "epc_price" });
    setProfiles([
      { id: "demo", customer_name: "Terawatt Admin", role: "admin" },
      {
        id: "demo-customer",
        customer_name: "ลูกค้าตัวอย่าง",
        role: "customer",
        price_column: null,
      },
    ]);
    setRole(r);
    setPage(0);
    setUser({ demo: true, id: "demo", email: "demo@terawatt" });
    setMessage("โหมดทดลอง • ข้อมูลในหน่วยความจำ ไม่บันทึกเข้า Supabase");
  }
  async function redeem(reward) {
    const cost = rewardCost(reward, settings);
    if (!customer) throw new Error("ไม่พบบัญชีลูกค้า");
    if (demo) {
      if (customer.banlance_tc < cost) throw new Error("แต้มไม่เพียงพอ");
      if (reward.stock <= 0) throw new Error("รางวัลหมด");
      const won =
        reward.option !== 3 ||
        crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296 <
          luckyProbability(settings, reward);
      setCustomers(
        customers.map((c) =>
          c.customer_id === customer.customer_id
            ? {
                ...c,
                used_tc: c.used_tc + cost,
                banlance_tc: c.banlance_tc - cost,
              }
            : c,
        ),
      );
      setRewards(
        rewards.map((r) =>
          r.id === reward.id ? { ...r, stock: r.stock - 1 } : r,
        ),
      );
      setLedger([
        {
          id: createRequestId(),
          customer_id: customer.customer_id,
          amount: -cost,
          description: reward.name,
          status: won ? "pending" : "no_prize",
          created_at: new Date().toISOString(),
        },
        ...ledger,
      ]);
      setMessage(
        won
          ? "ส่งคำขอแลกรางวัลแล้ว • รอผู้ดูแลดำเนินการ"
          : "ครั้งนี้ไม่ได้รับรางวัล ระบบหักแต้มแล้ว",
      );
    } else {
      const result = await api.rpc("tc_redeem", {
        reward_id: reward.id,
        request_id: createRequestId(),
      });
      setMessage(
        result.won
          ? "ส่งคำขอแลกรางวัลแล้ว รอผู้ดูแลดำเนินการ"
          : "ครั้งนี้ไม่ได้รับรางวัล ระบบหักแต้มแล้ว",
      );
    }
  }
  if (!user)
    return (
      <Login
        registrationSuccess={registrationSuccess}
        onRegistrationContinue={() => {
          const completed = registrationSuccess;
          setRegistrationSuccess(null);
          setMessage("");
          if (completed?.user) {
            clearAccountData();
            setUser(completed.user);
          }
        }}
        busy={busy}
        connected={connected}
        message={online ? message : offlineMessage}
        onDemo={privatePilot ? undefined : demoLogin}
        onSubmit={(email, password, name, signup, companyData) =>
          action(async () => {
            const result = signup
              ? await api.signup(email, password, name, companyData)
              : await api.login(email, password);
            if (signup) {
              const registeredUser = result.user || (result.id ? result : null);
              if (!registeredUser)
                throw new Error("สมัครสมาชิกไม่สำเร็จ กรุณาลองใหม่");
              if (result.access_token) setSession(result);
              setRegistrationSuccess({
                email,
                requiresConfirmation: !result.access_token,
                user: result.access_token ? registeredUser : null,
              });
              setMessage("");
              return;
            }
            if (!result.access_token) throw new Error("เข้าสู่ระบบไม่สำเร็จ");
            setSession(result);
            clearAccountData();
            setUser(result.user);
          })
        }
      />
    );
  return (
    <div className="app-shell">
      <aside>
        <div className="brand">
          <span className="brand-symbol">T</span>
          <div>
            TeraCoin<small>by TERAWATT</small>
          </div>
        </div>

        <Navigation
          page={page}
          admin={admin}
          demo={demo}
          awaitingEpcApproval={awaitingEpcApproval}
          onNavigate={(nextPage) => {
            setPage(nextPage);
            setMessage("");
          }}
        />
        <div className="sidebar-bottom">
          <span className="status-dot" />{" "}
          {demo ? "โหมดทดลอง" : "เชื่อมต่อ Supabase"}
          <small>{role.toUpperCase()}</small>
          <button
            onClick={() =>
              action(async () => {
                if (!demo) await api.logout();
                setSession(null);
                setUser(null);
                clearAccountData();
                setPage(0);
              })
            }
          >
            ออกจากระบบ ↗
          </button>
        </div>
      </aside>
      {selectedReward && (
        <RewardDetails
          reward={selectedReward}
          rewards={rewards}
          settings={settings}
          balance={balance}
          busy={busy}
          canRedeem={!staff && redemptionReady}
          onClose={() => setSelectedReward(null)}
          onConfirm={async (r) => {
            let done = false;
            await action(async () => {
              await redeem(r);
              done = true;
            });
            if (done) setSelectedReward(null);
          }}
        />
      )}
      <main className={page === salesReviewPage ? "sales-review-page" : undefined}>
        <header>
          <div>
            {page !== salesReviewPage && <div className="eyebrow">TERAWATT / TERACOIN</div>}
            <h1>{page === 8 ? "ข้อมูลบริษัท" : page === 9 ? "เอกสารขาย" : page === salesReviewPage ? salesReviewTitle : labels[page]}</h1>
          </div>
          <button
            type="button"
            className="account account-link"
            onClick={() => {
              setPage(8);
              setMessage("");
            }}
            aria-label="เปิดข้อมูลบริษัท"
          >
            <span className="avatar">{staff ? "TW" : "TC"}</span>
            <span>
              {staff
                ? "Terawatt Team"
                : customer?.customer_name || "สมาชิกใหม่"}
              <small>{demo ? "Demo workspace" : user.email}</small>
            </span>
            <span className="account-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </header>
        {page !== salesReviewPage && staff && !membershipReady && (
          <div className="notice">
            สูตรสะสมรุ่นใหม่และ B แยกรายชิ้นยังรออัปเดต 007 • B รายประเภทในแท็บ
            TC แลกรางวัลแก้และบันทึกได้แล้ว
          </div>
        )}
        {page !== salesReviewPage && staff && membershipReady && !rewardBReady && (
          <div className="notice">
            B รายประเภทแก้และบันทึกได้แล้ว • หากต้องการ B เฉพาะชิ้นและ TC ทศนิยม
            ให้รัน supabase/007_reward_multipliers.sql
          </div>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
          </div>
        )}
        {busy && <div className="notice">กำลังดำเนินการ…</div>}
        {!online && <p className="notice" role="status">{offlineMessage}</p>}
        {page === 8 && (
          <section className="company-page">
            {awaitingEpcApproval ? (
              <div className="notice">
                <p>สำหรับทีม Terawatt และคู่ค้า EPC ที่ผ่านการยืนยันจากผู้ดูแล</p>
                <button type="button" disabled={busy || !online} onClick={() => action(() => load(), false)}>
                  ตรวจสถานะการอนุมัติ
                </button>
              </div>
            ) : (
              <button className="company-back" onClick={() => setPage(0)}>
              ← กลับหน้าภาพรวม
            </button>
            )}
            <p className="company-intro">
              ตรวจสอบข้อมูลบัญชีและยืนยันบริษัทของคุณ
            </p>
            {!staff && !demo && customer ? (
              <EpcRegistration
                key={epcRequest?.updated_at || "new"}
                api={api}
                customer={customer}
                request={epcRequest}
                onReload={() => load()}
              />
            ) : (
              <section className="panel">
                <h2>
                  {staff
                    ? "Terawatt Team"
                    : customer?.customer_name || "บัญชีของคุณ"}
                </h2>
                <p>{user.email}</p>
              </section>
            )}
          </section>
        )}
        {page === 0 && (
          <>
            {!staff && !demo && customer && (
              <FlowAccountCustomer
                api={api}
                customer={customer}
                onRewards={() => setPage(1)}
              />
            )}
            {(staff || demo || !customer) && (
              <section className="hero solar-hero">
                <div>
                  <div className="eyebrow">TERAWATT SOLAR REWARDS</div>
                  <h2>พลังงานโซลาร์<br />เปลี่ยนเป็นรางวัล</h2>
                  <p>
                    สะสม TeraCoin จากยอดซื้ออุปกรณ์โซลาร์ ใช้แลกเงินคืนและสิทธิประโยชน์ตามเงื่อนไข
                  </p>
                  <button className="light" onClick={() => setPage(1)}>
                    ดูรางวัลและเงินคืน
                  </button>
                </div>

              </section>
            )}
            <div className="stats">
              <Stat
                title={staff ? "แต้มคงเหลือรวม" : "TeraCoin ของคุณ"}
                value={fmt(balance)}
                unit="TC"
              />
              <Stat
                title="มูลค่าตามอัตราสำรอง"
                value={fmt(tcValue)}
                unit="บาท"
              />
              <Stat title="Liability" value={fmt(liability)} unit="บาท" />
              <Stat
                title="อัตราสำรอง Liability"
                value={fmt(settings.baht_per_tc)}
                unit="บาท / TC"
              />
            </div>
            <div className="section-title">
              <h2>สิทธิประโยชน์ที่เติบโตไปกับคุณ</h2>
              <button className="text" onClick={() => setPage(1)}>
                ดูทั้งหมด ↗
              </button>
            </div>
            <div className="reward-grid">
              {rewards
                .filter((r) => r.active)
                .map((r) => (
                  <Reward
                    key={r.id}
                    reward={r}
                    settings={settings}
                    onClick={() => setPage(1)}
                  />
                ))}
            </div>
            {staff && <Formula products={products} settings={settings} />}
          </>
        )}
        {page === 1 && (
          <>
            <p className="muted">
              เลือกใช้แต้มตามเป้าหมายของคุณ • มูลค่าที่แลกได้ขึ้นอยู่กับตัวคูณ B
              ของแต่ละรางวัล
            </p>
            <div className="reward-grid">
              {rewards
                .filter((r) => r.active)
                .map((r) => (
                  <Reward
                    key={r.id}
                    reward={r}
                    settings={settings}
                    disabled={busy}
                    onClick={() => setSelectedReward(r)}
                  />
                ))}
            </div>
            {staff && (
              <p className="muted">การแลกรางวัลทำได้จากบัญชีลูกค้าเท่านั้น</p>
            )}
            {admin && (
              <section className="panel">
                <h2>จัดการรางวัล</h2>
                <button
                  onClick={() =>
                    setEditReward({
                      option: 1,
                      name: "",
                      description: "",
                      value_baht: 0,
                      y: 1,
                      stock: 0,
                      active: true,
                      prize_name: "",
                      prize_value_baht: 0,
                    })
                  }
                >
                  + เพิ่มรางวัล
                </button>
                {rewards.map((r) => (
                  <div className="list-row" key={r.id}>
                    <span>
                      {r.name} · B {fmt(rewardB(r, settings))} TC / บาท · ใช้{" "}
                      {fmt(rewardCost(r, settings))} TC · คงเหลือ {r.stock} ·{" "}
                      {r.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                    </span>
                    <button onClick={() => setEditReward(r)}>แก้ไข</button>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
        {page === 2 && (
          <section className="panel">
            <h2>ประวัติสะสมและแลกรางวัล</h2>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>วันที่</th>
                    <th>ลูกค้า</th>
                    <th>รายการ</th>
                    <th>TC</th>
                    <th>สถานะ</th>
                    {admin && <th>ดำเนินการ</th>}
                  </tr>
                </thead>
                <tbody>
                  {ledger
                    .slice()
                    .sort(
                      (a, b) => new Date(b.created_at) - new Date(a.created_at),
                    )
                    .map((l) => (
                      <tr key={l.id}>
                        <td>
                          {new Date(l.created_at).toLocaleString("th-TH")}
                        </td>
                        <td>{l.customer_id}</td>
                        <td>{l.description}</td>
                        <td className={l.amount > 0 ? "positive" : ""}>
                          {fmt(l.amount)}
                        </td>
                        <td>
                          {{
                            pending: "รอดำเนินการ",
                            fulfilled: "ส่งมอบแล้ว",
                            earned: "ได้รับแต้ม",
                            no_prize: "ไม่ได้รับรางวัล",
                          }[l.status] || l.status}
                        </td>
                        {admin && (
                          <td>
                            {l.status === "pending" && (
                              <button
                                disabled={busy}
                                onClick={() =>
                                  action(async () => {
                                    if (demo)
                                      setLedger(
                                        ledger.map((x) =>
                                          x.id === l.id
                                            ? { ...x, status: "fulfilled" }
                                            : x,
                                        ),
                                      );
                                    else
                                      await api.rpc("tc_fulfill", {
                                        entry_id: l.id,
                                      });
                                  })
                                }
                              >
                                ยืนยันส่งมอบ
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
              {!ledger.length && (
                <div className="empty">ยังไม่มีรายการสะสมหรือแลกแต้ม</div>
              )}
            </div>
          </section>
        )}
        {page === 3 &&
          (staff ? (
            <StockTable
              onConnect={() => action(connectLive, false)}
              status={stockStatus}
              error={stockError}
              products={products}
              settings={settings}
              admin={admin}
              demo={demo}
              busy={busy}
              search={search}
              onSearch={setSearch}
              onEdit={setEditProduct}
              onRefresh={() => action(() => refreshProducts(true), false)}
              onAdd={() =>
                setEditProduct({
                  main: "",
                  product: "",
                  model: "",
                  Qty: 0,
                  tier_2_price: 0,
                  tier_2_cost: 0,
                  epc_price: 0,
                })
              }
            />
          ) : (
            <CustomerCatalog
              products={products}
              tier={ownProfile?.price_column}
              loading={busy}
              onRefresh={() =>
                action(async () => {
                  if (!demo) await load();
                })
              }
            />
          ))}
        {page === salesReviewPage && admin && !demo && <SalesReview api={api} />}
        {page === 9 && admin && <FlowAccountDocuments demo={demo} api={api} />}
        {page === 7 && admin && (
          <FlowAccountPanel
            products={products}
            customers={customers}
            settings={settings}
            demo={demo}
            api={api}
            onReload={() => load()}
          />
        )}
        {page === 4 && admin && (
          <SaleForm
            products={products}
            customers={customers}
            profiles={profiles}
            settings={settings}
            busy={busy || !membershipReady}
            onSave={async (bill) => {
              let saved = false;
              await action(async () => {
                if (demo) {
                  const c = customers.find(
                    (c) => c.customer_id === bill.customer,
                  );
                  if (!c) throw Error("กรุณาเลือกลูกค้า");
                  if (
                    ledger.some(
                      (l) => l.reference === bill.sale_reference.trim(),
                    )
                  )
                    throw Error("เลขอ้างอิงซ้ำ");
                  const stock = new Map(
                    products.map((p) => [p.id, number(p.Qty)]),
                  );
                  let tc = 0;
                  const lines = [];
                  for (const line of bill.items) {
                    const p = products.find((p) => p.id === line.product_id);
                    if (!p || stock.get(p.id) < line.quantity)
                      throw Error("สต็อกไม่เพียงพอ");
                    stock.set(p.id, stock.get(p.id) - line.quantity);
                    const result = calculate(p, line.quantity, settings, line);
                    if (result.error) throw Error(result.error);
                    tc += result.tc;
                    lines.push({
                      ...line,
                      product: p,
                      group_b:
                        settings.membership_config?.groups?.[p.product]?.b ??
                        settings.y,
                      result,
                    });
                  }
                  tc = Math.round(tc * 100) / 100;
                  setProducts(
                    products.map((p) => ({ ...p, Qty: stock.get(p.id) })),
                  );
                  setCustomers(
                    customers.map((x) =>
                      x.customer_id === c.customer_id
                        ? {
                            ...x,
                            total_earn: number(x.total_earn) + tc,
                            banlance_tc: number(x.banlance_tc) + tc,
                          }
                        : x,
                    ),
                  );
                  setLedger([
                    {
                      id: createRequestId(),
                      customer_id: c.customer_id,
                      amount: tc,
                      description: `ยอดขาย ${bill.sale_reference}`,
                      reference: bill.sale_reference.trim(),
                      snapshot: { lines, settings },
                      status: "earned",
                      created_at: new Date().toISOString(),
                    },
                    ...ledger,
                  ]);
                } else
                  await api.rpc("tc_record_sale", {
                    ...bill,
                    request_id: createRequestId(),
                  });
                setMessage("บันทึกยอดขายและแต้มแล้ว");
                saved = true;
              });
              return saved;
            }}
          />
        )}
        {page === 5 && admin && (
          <>
            <div className="formula-category-tabs" role="group" aria-label="หมวดตั้งค่าระบบ">
              <button
                type="button"
                aria-pressed={settingsSection === "accrual"}
                aria-controls="settings-accrual"
                onClick={() => setSettingsSection("accrual")}
              >
                การสะสมและสำรองแต้ม
              </button>
              <button
                type="button"
                aria-pressed={settingsSection === "formulas"}
                aria-controls="settings-formulas"
                onClick={() => setSettingsSection("formulas")}
              >
                สูตรการคำนวณ
              </button>
            </div>
            <div id="settings-accrual" hidden={settingsSection !== "accrual"}>
              <SettingsFields
                products={products}
                key={JSON.stringify(settings)}
                settings={settings}
                busy={busy || !settings.membership_config}
                onSave={(values) =>
                  action(async () => {
                    if (demo) setSettings({ ...settings, ...values });
                    else
                      await api.save("tc_settings", { ...settings, ...values });
                    setMessage("Saved settings");
                  })
                }
              />
            </div>
            <div id="settings-formulas" hidden={settingsSection !== "formulas"}>
              <FormulaEditor
                key={settings.formula_revision || "initial"}
                settings={settings}
                products={products}
                rewards={rewards}
                customers={customers}
                demo={demo}
                busy={busy}
                onSave={(rules, reward_bs) =>
                  action(async () => {
                    if (demo)
                      setSettings({
                        ...settings,
                        formulas: rules,
                        ...(reward_bs
                          ? {
                              membership_config: {
                                ...settings.membership_config,
                                reward_b: reward_bs,
                              },
                            }
                          : {}),
                        formula_revision: (settings.formula_revision || 0) + 1,
                      });
                    else if (reward_bs)
                      await api.rpc("tc_save_reward_formulas", {
                        rules,
                        reward_bs,
                        expected_revision: settings.formula_revision,
                      });
                    else
                      await api.rpc("tc_save_formulas", {
                        rules,
                        expected_revision: settings.formula_revision,
                      });
                    setMessage(
                      "บันทึกสูตรแล้ว ใช้กับรายการใหม่ ส่วน Liability ประเมินใหม่ตามสูตร",
                    );
                  })
                }
              />
              <details className="advanced-formula-summary">
                <summary>ดูสูตรที่บันทึกไว้ทั้งหมด</summary>
                <Formula products={products} settings={settings} />
              </details>
            </div>
          </>
        )}
        {page === 6 && admin && !demo && (
          <>
            <EpcApprovals api={api} onReload={() => load()} />
            <AdminTeamSignup api={api} onCreated={() => load()} />
          </>
        )}
        {page === 6 && admin && (
          <section className="panel">
            <h2>ลูกค้าและสิทธิ์ผู้ใช้งาน</h2>
            <p className="muted">
              Admin แก้ไขได้ทั้งหมด • Viewer อ่านข้อมูลทีม • Customer
              ดูและแลกแต้มของตนเอง
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Customer ID</th>
                    <th>ชื่อลูกค้า</th>
                    <th>สะสมทั้งหมด</th>
                    <th>ใช้แล้ว</th>
                    <th>คงเหลือ</th>
                    <th>Liability (บาท)</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.customer_id}>
                      <td>{c.customer_id}</td>
                      <td>{c.customer_name}</td>
                      <td>{fmt(c.total_earn)}</td>
                      <td>{fmt(c.used_tc)}</td>
                      <td>{fmt(c.banlance_tc)}</td>
                      <td>
                        {fmt(customerMetric("liability_amount", c, settings))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <UserAccess
              onAccount={async (p, operation, confirmation) => {
                let done = false;
                await action(async () => {
                  if (demo)
                    setProfiles(
                      profiles.map((v) =>
                        v.id === p.id
                          ? {
                              ...v,
                              account_status: {
                                suspend: "suspended",
                                resume: "active",
                                delete: "deleted",
                              }[operation],
                            }
                          : v,
                      ),
                    );
                  else
                    await api.rpc("tc_manage_epc", {
                      profile: p.id,
                      operation,
                      expected: p.account_updated_at,
                      confirm_name: confirmation || null,
                    });
                  setMessage(
                    {
                      suspend: "ระงับบัญชีแล้ว",
                      resume: "เปิดใช้งานบัญชีแล้ว",
                      delete:
                        "ลบบัญชีออกจากรายชื่อใช้งานแล้ว เก็บประวัติไว้ตรวจสอบ",
                    }[operation],
                  );
                  done = true;
                });
                return done;
              }}
              profiles={profiles}
              priceColumns={priceColumns}
              busy={busy}
              userId={user.id}
              onRole={(id, next) => {
                if (!demo && next === "admin") {
                  const accountName = profiles.find(profile => profile.id === id)?.customer_name || id;
                  if (!window.confirm(`ให้สิทธิ์ Admin แก่ ${accountName} ใช่หรือไม่? บัญชีนี้จะจัดการผู้ใช้งานและดูข้อมูลบริษัทใน TeraCoin ได้`)) return;
                }
                return action(async () => {
                  if (demo)
                    setProfiles(
                      profiles.map((p) =>
                        p.id === id ? { ...p, role: next } : p,
                      ),
                    );
                  else
                    await api.rpc("tc_set_role", {
                      profile_id: id,
                      new_role: next,
                    });
                });
              }}
              onPrice={(id, column) =>
                action(async () => {
                  if (demo)
                    setProfiles(
                      profiles.map((p) =>
                        p.id === id ? { ...p, price_column: column } : p,
                      ),
                    );
                  else
                    await api.rpc("tc_set_customer_price", {
                      profile_id: id,
                      price_column: column,
                    });
                  setMessage(
                    column ? "อนุมัติระดับราคาแล้ว" : "ระงับสิทธิ์ราคาแล้ว",
                  );
                })
              }
            />
          </section>
        )}
        <footer>
          TERACOIN · พลังงานที่สร้างคุณค่าให้ทุกความสัมพันธ์{" "}
          <span>สำรอง Liability {fmt(settings.baht_per_tc)} บาท / TC</span>
        </footer>
      </main>
      {editProduct && (
        <Editor
          title="จัดการสินค้า"
          productFields
          formulaTargets={Object.keys(settings.formulas || {})}
          value={editProduct}
          onClose={() => setEditProduct(null)}
          onSave={(v) =>
            action(async () => {
              if (demo)
                setProducts(
                  v.id
                    ? products.map((p) => (p.id === v.id ? v : p))
                    : [...products, { ...v, id: createRequestId() }],
                );
              else await api.save("stock_profit", v);
              setEditProduct(null);
              setMessage("บันทึกสินค้าแล้ว");
            })
          }
        />
      )}
      {editReward && (
        <RewardEditor
          settings={settings}
          busy={busy || !membershipReady || !rewardBReady}
          value={editReward}
          onClose={() => setEditReward(null)}
          onSave={(v) =>
            action(async () => {
              if (demo)
                setRewards(
                  v.id
                    ? rewards.map((r) => (r.id === v.id ? v : r))
                    : [...rewards, { ...v, id: createRequestId() }],
                );
              else await api.save("tc_rewards", v);
              setEditReward(null);
              setMessage("บันทึกรางวัลแล้ว");
            })
          }
        />
      )}
    </div>
  );
}
function Stat({ title, value, unit }) {
  return (
    <div className="stat">
      <span>{title}</span>
      <strong>
        {value} <small>{unit}</small>
      </strong>
      <div className="stat-line" />
    </div>
  );
}
function Reward({ reward: r, settings, onClick, disabled }) {
  return (
    <article className={`reward option-${r.option}`}>
      <div className="reward-art">
        <span>{["", "▦", "↗", "✧", "✈"][r.option]}</span>
        <small>OPTION 0{r.option}</small>
      </div>
      <div className="reward-body">
        <h3>{r.name}</h3>
        <p>{r.description}</p>
        {r.option === 3 && (
          <small>
            โอกาสได้รับ {fmt(luckyProbability(settings, r) * 100)}% • รางวัล{" "}
            {r.prize_name || "Voucher"} {fmt(r.prize_value_baht)} บาท
            <br />
            หักแต้มทุกครั้ง ผลสุ่มไม่รับประกันชนะทุก 5 ครั้ง
          </small>
        )}
        <div className="reward-bottom">
          <strong>
            {fmt(rewardCost(r, settings))} <small>TC</small>
          </strong>
          <button disabled={disabled || r.stock <= 0} onClick={onClick}>
            {r.stock <= 0 ? "หมดแล้ว" : "แลกรางวัล ↗"}
          </button>
        </div>
      </div>
    </article>
  );
}
function Formula(props) {
  return <FormulaSummary {...props} />;
}
function Editor({
  title,
  value,
  onClose,
  onSave,
  productFields = false,
  formulaTargets = [],
}) {
  const [v, setV] = useState({ ...value });
  return (
    <div className="modal-backdrop">
      <section className="modal panel">
        <div className="section-title">
          <h2>{title}</h2>
          <button onClick={onClose}>ปิด ×</button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(v);
          }}
        >
          {Object.keys(v)
            .filter((k) => !["id", "created_at"].includes(k))
            .sort((a, b) =>
              productFields ? stockHeader(a).order - stockHeader(b).order : 0,
            )
            .map((k) => (
              <label key={k}>
                {productFields ? stockHeader(k).label : k}
                {productFields && formulaTargets.includes(k) && (
                  <small>มีสูตรคำนวณ • ช่องนี้เป็นค่าดิบต้นทาง (raw_{k})</small>
                )}
                {typeof v[k] === "boolean" ? (
                  <select
                    value={String(v[k])}
                    onChange={(e) =>
                      setV({ ...v, [k]: e.target.value === "true" })
                    }
                  >
                    <option value="true">เปิดใช้งาน</option>
                    <option value="false">ปิดใช้งาน / ยกเลิกสินค้า</option>
                  </select>
                ) : (
                  <input
                    required={!["prize_name", "description"].includes(k)}
                    type={typeof value[k] === "number" ? "number" : "text"}
                    step="any"
                    min={["y", "value_baht"].includes(k) ? "0.01" : undefined}
                    value={v[k] ?? ""}
                    onChange={(e) =>
                      setV({
                        ...v,
                        [k]:
                          typeof value[k] === "number"
                            ? number(e.target.value)
                            : e.target.value,
                      })
                    }
                  />
                )}
              </label>
            ))}
          <button>บันทึก</button>
        </form>
      </section>
    </div>
  );
}
export { Login };
