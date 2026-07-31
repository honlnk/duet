<script setup lang="ts">
import {
  fetchExchangeRates,
  fetchModelPricing,
  fetchModelsByCred,
  fetchProviderModels,
} from "@/services/api";
import { useProviderStore } from "@/stores/provider";
import type {
  ApiProtocol,
  ProviderListItem,
  ProviderPricing,
} from "@/types/api";
import { storeToRefs } from "pinia";
import { computed, reactive, ref } from "vue";
import NumberStepper from "./NumberStepper.vue";

const emit = defineEmits<{ close: [] }>();

/**
 * 内嵌模式：true 时不渲染遮罩/外层壳/关闭按钮，
 * 供 SettingsModal 作为 Provider tab 嵌入；false（默认）为独立居中模态。
 */
const props = withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false,
});

const providerStore = useProviderStore();
const { providers, defaultId } = storeToRefs(providerStore);

/** 编辑模式：null = 列表态，对象 = 编辑该条，'new' = 新增 */
const editing = ref<null | string | "new">(null);
const saving = ref(false);
const errorMsg = ref("");

/** 默认 pricing（新增态表单初值：价格留空，等选模型自动填充或手填） */
function defaultPricing(): ProviderPricing {
  return {
    currency: "CNY",
    inputPerMTok: 0,
    outputPerMTok: 0,
    cacheHitEnabled: true,
    cacheHitPerMTok: 0,
    cacheWriteEnabled: false,
    cacheWritePerMTok: 0,
  };
}

/** 协议选项：值 + 显示名 + 对应官方 baseUrl 占位符 */
const protocolOptions: Array<{
  value: ApiProtocol;
  label: string;
  baseUrl: string;
}> = [
  {
    value: "openai",
    label: "OpenAI 兼容",
    baseUrl: "https://api.deepseek.com/v1",
  },
  {
    value: "openai-responses",
    label: "OpenAI Responses",
    baseUrl: "https://api.openai.com/v1",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    baseUrl: "https://api.anthropic.com",
  },
  {
    value: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
  },
];

/** 协议 → 显示名（列表标签用） */
function protocolLabel(p: ApiProtocol): string {
  return protocolOptions.find((o) => o.value === p)?.label ?? p;
}

/** 当前协议对应的 baseUrl 占位符 */
const baseUrlPlaceholder = computed(() => {
  const opt = protocolOptions.find((o) => o.value === form.protocol);
  return opt?.baseUrl ?? "https://api.example.com/v1";
});

const form = reactive({
  name: "",
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  apiKeyConfirm: "",
  model: "",
  protocol: "openai" as ApiProtocol,
  ...defaultPricing(),
});

/** 切换协议时，若 baseUrl 为空或仍是某协议默认值，则更新为该协议的默认地址 */
function onProtocolChange() {
  const opt = protocolOptions.find((o) => o.value === form.protocol);
  if (!opt) return;
  // 当前 baseUrl 为空，或等于任意协议的默认地址时，自动切换到新协议的默认地址
  const isDefault =
    !form.baseUrl.trim() ||
    protocolOptions.some((o) => o.baseUrl === form.baseUrl);
  if (isDefault) form.baseUrl = opt.baseUrl;
}

/* ----------------------- 模型列表拉取 ----------------------- */
const modelsLoading = ref(false);
const modelsList = ref<string[]>([]);
const modelsError = ref("");
/** 模型下拉是否展开 */
const modelsDropdownOpen = ref(false);
/** 输入框值过滤后的模型选项 */
const filteredModels = computed(() => {
  const q = form.model.trim().toLowerCase();
  if (!q) return modelsList.value;
  return modelsList.value.filter((m) => m.toLowerCase().includes(q));
});

/** 模型价格自动填充 loading 状态 */
const pricingLoading = ref(false);

/** 选中某个模型，并自动查询价格填充表单 */
function pickModel(m: string) {
  form.model = m;
  modelsDropdownOpen.value = false;
  // 异步查价，不阻塞交互
  void autofillPricing(m);
}

/**
 * 从 OpenRouter 查询模型价格并填入表单。
 * 查不到则静默跳过（用户可手动填）；价格统一设为 USD。
 */
async function autofillPricing(modelId: string) {
  pricingLoading.value = true;
  try {
    const res = await fetchModelPricing(modelId);
    if (!res.found || !res.pricing) return;
    const p = res.pricing;
    form.currency = "USD";
    prevCurrency.value = "USD";
    form.inputPerMTok = p.inputPerMTok;
    form.outputPerMTok = p.outputPerMTok;
    // 缓存命中：有数据则自动开启并填价
    if (p.hasCacheHit) {
      form.cacheHitEnabled = true;
      form.cacheHitPerMTok = p.cacheHitPerMTok;
    }
    // 缓存写入：有数据则自动开启并填价；无则保持关闭
    if (p.hasCacheWrite) {
      form.cacheWriteEnabled = true;
      form.cacheWritePerMTok = p.cacheWritePerMTok;
    }
  } catch {
    // 查价失败不报错，价格表单保持现状
  } finally {
    pricingLoading.value = false;
  }
}

/** 拉取模型列表：编辑态用已保存 id，新增态用临时凭证 */
async function loadModels() {
  modelsError.value = "";
  // 新增态：必须有 baseUrl + apiKey 才能拉
  if (editing.value === "new") {
    if (!form.baseUrl.trim()) {
      modelsError.value = "请先填写 Base URL";
      return;
    }
    if (!form.apiKey.trim()) {
      modelsError.value = "请先填写 API Key";
      return;
    }
  }
  modelsLoading.value = true;
  try {
    const res =
      editing.value && editing.value !== "new"
        ? await fetchProviderModels(editing.value)
        : await fetchModelsByCred(
            form.baseUrl.trim(),
            form.apiKey.trim(),
            form.protocol,
          );
    modelsList.value = res.models;
    if (res.models.length === 0) {
      modelsError.value = "上游未返回任何模型";
    }
  } catch (e) {
    modelsError.value = (e as Error).message;
    modelsList.value = [];
  } finally {
    modelsLoading.value = false;
  }
}

/** 货币选项 */
const currencyOptions = [
  { code: "CNY", symbol: "¥" },
  { code: "USD", symbol: "$" },
  { code: "EUR", symbol: "€" },
];

function currencySymbol(code: string): string {
  return currencyOptions.find((c) => c.code === code)?.symbol ?? code + " ";
}

/* ----------------------- 货币切换汇率换算 ----------------------- */
/** 汇率缓存：各货币对 USD 的比率（懒加载） */
const exchangeRates = ref<Record<string, number> | null>(null);
const rateLoading = ref(false);

/** 懒加载汇率（首次切换货币时拉取，之后复用） */
async function ensureRates(): Promise<Record<string, number> | null> {
  if (exchangeRates.value) return exchangeRates.value;
  rateLoading.value = true;
  try {
    const res = await fetchExchangeRates();
    exchangeRates.value = res.rates;
    return res.rates;
  } catch {
    return null;
  } finally {
    rateLoading.value = false;
  }
}

/** 记录货币切换前的旧值，供换算用 */
const prevCurrency = ref(form.currency);

/** 货币切换：按汇率把四个价格从旧货币换算到新货币 */
async function onCurrencyChange() {
  const from = prevCurrency.value;
  const to = form.currency;
  if (from === to) return;
  prevCurrency.value = to;

  const rates = await ensureRates();
  if (!rates) return; // 汇率获取失败则不换算，保留原值

  // 换算公式：to 金额 = from 金额 / fromRate * toRate（rate 均为对 USD 的比率）
  const fromRate = rates[from] ?? 1;
  const toRate = rates[to] ?? 1;
  const ratio = toRate / fromRate;
  form.inputPerMTok = round4p(form.inputPerMTok * ratio);
  form.outputPerMTok = round4p(form.outputPerMTok * ratio);
  form.cacheHitPerMTok = round4p(form.cacheHitPerMTok * ratio);
  form.cacheWritePerMTok = round4p(form.cacheWritePerMTok * ratio);
}

/** 保留 4 位小数 */
function round4p(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/* ----------------------- 编辑/新增/保存 ----------------------- */

/** 进入编辑/新增模式时预填表单 */
function startEdit(p: ProviderListItem) {
  editing.value = p.id;
  errorMsg.value = "";
  form.name = p.name;
  form.baseUrl = p.baseUrl;
  form.apiKey = ""; // 编辑时不回显真实 key
  form.apiKeyConfirm = "";
  form.model = p.model;
  form.protocol = p.protocol;
  Object.assign(form, defaultPricing(), p.pricing);
  prevCurrency.value = form.currency;
  modelsList.value = [];
  modelsError.value = "";
}

function startNew() {
  editing.value = "new";
  errorMsg.value = "";
  Object.assign(form, {
    name: "",
    baseUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    apiKeyConfirm: "",
    model: "",
    protocol: "openai" as ApiProtocol,
    ...defaultPricing(),
  });
  prevCurrency.value = form.currency;
  modelsList.value = [];
  modelsError.value = "";
}

function cancelEdit() {
  editing.value = null;
  errorMsg.value = "";
}

async function save() {
  errorMsg.value = "";
  // 基本校验
  if (!form.name.trim()) {
    errorMsg.value = "请填写名称";
    return;
  }
  if (!form.baseUrl.trim()) {
    errorMsg.value = "请填写 Base URL";
    return;
  }
  if (!form.model.trim()) {
    errorMsg.value = "请填写模型名";
    return;
  }

  // 新增必须有 apiKey；编辑时 apiKey 为空 = 不修改
  if (editing.value === "new" && !form.apiKey.trim()) {
    errorMsg.value = "新增时必须填写 API Key";
    return;
  }

  saving.value = true;
  try {
    const pricing: ProviderPricing = {
      currency: form.currency,
      inputPerMTok: form.inputPerMTok,
      outputPerMTok: form.outputPerMTok,
      cacheHitEnabled: form.cacheHitEnabled,
      cacheHitPerMTok: form.cacheHitPerMTok,
      cacheWriteEnabled: form.cacheWriteEnabled,
      cacheWritePerMTok: form.cacheWritePerMTok,
    };
    if (editing.value === "new") {
      await providerStore.create({
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        model: form.model.trim(),
        protocol: form.protocol,
        pricing,
      });
    } else if (editing.value) {
      const data: Record<string, unknown> = {
        name: form.name.trim(),
        baseUrl: form.baseUrl.trim(),
        model: form.model.trim(),
        protocol: form.protocol,
        pricing,
      };
      // 只在用户填了新 key 时才传
      if (form.apiKey.trim()) {
        data.apiKey = form.apiKey.trim();
      }
      await providerStore.update(editing.value, data);
    }
    editing.value = null;
  } catch (e) {
    errorMsg.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function remove(id: string) {
  errorMsg.value = "";
  if (!confirm("确定删除该 Provider？")) return;
  try {
    await providerStore.remove(id);
  } catch (e) {
    errorMsg.value = (e as Error).message;
  }
}

async function setDefault(id: string) {
  errorMsg.value = "";
  try {
    await providerStore.setDefault(id);
  } catch (e) {
    errorMsg.value = (e as Error).message;
  }
}

/* ----------------------- 蒙层点击关闭 ----------------------- */
/**
 * 记录 mousedown 是否发生在蒙层本身。
 * 配合 mouseup 判断：只有「按下与松开都在蒙层上」才视为点击蒙层关闭，
 * 避免「弹窗内选中文本拖到蒙层松开」误触发关闭。
 */
const mouseDownOnOverlay = ref(false);

function onOverlayMouseDown(e: MouseEvent) {
  mouseDownOnOverlay.value = e.target === e.currentTarget;
}

function onOverlayMouseUp(e: MouseEvent) {
  // 仅当按下与松开都在蒙层上时才关闭
  if (mouseDownOnOverlay.value && e.target === e.currentTarget) {
    emit("close");
  }
  mouseDownOnOverlay.value = false;
}
</script>

<template>
  <!--
    容器：embedded 模式为普通 div（嵌入 SettingsModal tab），独立模式为居中遮罩模态。
    mousedown/mouseup 都在蒙层本身时才关闭，避免选中文本拖出松开误触发。
  -->
  <div
    :class="embedded ? 'flex h-full flex-col' : 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'"
    @mousedown="embedded ? undefined : onOverlayMouseDown"
    @mouseup="embedded ? undefined : onOverlayMouseUp"
  >
    <!-- 面板主体 -->
    <div
      :class="embedded
        ? 'flex h-full w-full flex-col overflow-hidden bg-white'
        : 'flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-soft shadow-2xl'"
    >
      <!-- 头部 -->
      <div
        class="flex items-center justify-between border-b border-border-subtle px-5 py-3"
      >
        <h2 class="text-sm font-semibold text-text-main">Provider 管理</h2>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-lg text-text-dim hover:bg-bg-hover hover:text-text-main"
          aria-label="关闭"
          @click="$emit('close')"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </button>
      </div>

      <!-- 内容区 -->
      <div class="flex-1 overflow-y-auto p-5">
        <!-- 列表态 -->
        <template v-if="editing === null">
          <!-- Provider 列表 -->
          <div class="flex flex-col gap-2">
            <div
              v-for="p in providers"
              :key="p.id"
              class="rounded-lg border border-border-subtle bg-bg-card p-3"
            >
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-medium text-text-main">{{
                      p.name
                    }}</span>
                    <span
                      v-if="p.id === defaultId"
                      class="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent"
                      >默认</span
                    >
                    <span
                      class="rounded bg-bg-hover px-1.5 py-0.5 text-[10px] text-text-dim"
                    >
                      {{ protocolLabel(p.protocol) }}
                    </span>
                  </div>
                  <div class="mt-0.5 truncate text-xs text-text-muted">
                    {{ p.baseUrl }}
                  </div>
                  <div
                    class="mt-1 flex items-center gap-3 text-xs text-text-dim"
                  >
                    <span>模型: {{ p.model }}</span>
                    <span class="font-mono">{{ p.apiKeyMasked }}</span>
                  </div>
                  <div class="mt-0.5 text-xs text-text-muted">
                    {{ currencySymbol(p.pricing.currency)
                    }}{{ p.pricing.inputPerMTok }}/M in ·
                    {{ currencySymbol(p.pricing.currency)
                    }}{{ p.pricing.outputPerMTok }}/M out
                    <span v-if="p.pricing.cacheHitEnabled" class="text-accent">
                      · 命中 {{ currencySymbol(p.pricing.currency)
                      }}{{ p.pricing.cacheHitPerMTok }}/M
                    </span>
                  </div>
                </div>
                <!-- 操作按钮 -->
                <div class="flex shrink-0 items-center gap-1">
                  <button
                    v-if="p.id !== defaultId"
                    type="button"
                    class="rounded px-2 py-1 text-xs text-text-dim hover:bg-bg-hover hover:text-accent"
                    @click="setDefault(p.id)"
                  >
                    设默认
                  </button>
                  <button
                    type="button"
                    class="rounded px-2 py-1 text-xs text-text-dim hover:bg-bg-hover hover:text-text-main"
                    @click="startEdit(p)"
                  >
                    编辑
                  </button>
                  <button
                    v-if="p.id !== defaultId"
                    type="button"
                    class="rounded px-2 py-1 text-xs text-text-dim hover:bg-bg-hover hover:text-danger"
                    @click="remove(p.id)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 空状态 -->
          <div
            v-if="providers.length === 0"
            class="py-8 text-center text-sm text-text-muted"
          >
            还没有配置任何 Provider
          </div>

          <!-- 新增按钮 -->
          <button
            type="button"
            class="mt-3 w-full rounded-lg border border-dashed border-border-subtle py-2 text-sm text-text-dim hover:border-accent hover:text-accent"
            @click="startNew"
          >
            + 新增 Provider
          </button>
        </template>

        <!-- 编辑/新增态 -->
        <template v-else>
          <div class="flex flex-col gap-3">
            <!-- API 协议：决定请求端点/鉴权/流式格式，切换时联动 baseUrl -->
            <div class="flex flex-col gap-1">
              <label class="text-xs text-text-dim">API 协议</label>
              <select
                v-model="form.protocol"
                class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                @change="onProtocolChange"
              >
                <option
                  v-for="o in protocolOptions"
                  :key="o.value"
                  :value="o.value"
                >
                  {{ o.label }}
                </option>
              </select>
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-text-dim">名称</label>
              <input
                v-model="form.name"
                type="text"
                placeholder="如 DeepSeek 官方"
                class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-text-dim">Base URL</label>
              <input
                v-model="form.baseUrl"
                type="text"
                :placeholder="baseUrlPlaceholder"
                class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs text-text-dim">
                API Key
                <span v-if="editing !== 'new'" class="text-text-muted"
                  >（留空 = 不修改）</span
                >
              </label>
              <input
                v-model="form.apiKey"
                type="password"
                :placeholder="
                  editing === 'new' ? 'sk-...' : '留空保持原 key 不变'
                "
                class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
              />
            </div>

            <!-- 模型 ID：支持手动输入 + 拉取下拉选择 -->
            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between">
                <label class="text-xs text-text-dim">模型名</label>
                <button
                  type="button"
                  class="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-dim hover:bg-bg-hover hover:text-accent disabled:opacity-50"
                  :disabled="modelsLoading"
                  @click="loadModels"
                >
                  <svg
                    v-if="modelsLoading"
                    class="animate-spin"
                    width="11"
                    height="11"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M8 2a6 6 0 1 0 6 6" stroke-linecap="round" />
                  </svg>
                  {{ modelsLoading ? "获取中…" : "获取列表" }}
                </button>
              </div>
              <div class="relative">
                <input
                  v-model="form.model"
                  type="text"
                  placeholder="deepseek-v4-flash"
                  class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  @focus="modelsDropdownOpen = modelsList.length > 0"
                  @blur="modelsDropdownOpen = false"
                />
                <!-- 模型下拉列表（正经的浮层，非原生 datalist 气泡） -->
                <ul
                  v-if="modelsDropdownOpen && filteredModels.length"
                  class="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-md border border-border-subtle bg-bg-card py-1 shadow-lg"
                >
                  <li
                    v-for="m in filteredModels"
                    :key="m"
                    class="cursor-pointer truncate px-2.5 py-1.5 text-sm text-text-main hover:bg-bg-hover"
                    @mousedown.prevent="pickModel(m)"
                  >
                    {{ m }}
                  </li>
                </ul>
              </div>
              <span v-if="modelsError" class="text-xs text-danger">{{
                modelsError
              }}</span>
              <span
                v-else-if="modelsList.length"
                class="text-xs text-text-muted"
              >
                已获取 {{ modelsList.length }} 个模型，可从下拉选择或手动输入
              </span>
            </div>

            <!-- 价格配置 -->
            <div
              class="rounded-lg border border-border-subtle bg-bg-card/50 p-3"
            >
              <div class="mb-2 flex items-center gap-2">
                <span class="text-xs font-medium text-text-dim">价格配置</span>
                <span
                  v-if="pricingLoading"
                  class="flex items-center gap-1 text-[10px] text-text-muted"
                >
                  <svg
                    class="animate-spin"
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M8 2a6 6 0 1 0 6 6" stroke-linecap="round" />
                  </svg>
                  查询价格中…
                </span>
                <span v-else class="text-[10px] text-text-muted"
                  >自动填充的价格来自 OpenRouter，仅供参考</span
                >
              </div>

              <!-- 货币：切换时按汇率自动换算价格 -->
              <div class="mb-2 flex flex-col gap-1">
                <label class="text-xs text-text-muted">
                  货币
                  <span v-if="rateLoading" class="text-text-muted"
                    >（获取汇率中…）</span
                  >
                </label>
                <select
                  v-model="form.currency"
                  class="w-full rounded-md border border-border-subtle bg-bg-card px-2.5 py-1.5 text-sm text-text-main outline-none focus:border-accent focus:ring-1 focus:ring-accent"
                  @change="onCurrencyChange"
                >
                  <option
                    v-for="c in currencyOptions"
                    :key="c.code"
                    :value="c.code"
                  >
                    {{ c.code }}（{{ c.symbol }}）
                  </option>
                </select>
              </div>

              <!-- 输入 / 输出 单价 -->
              <div class="flex gap-3">
                <div class="flex flex-1 flex-col gap-1">
                  <label class="text-xs text-text-muted"
                    >输入（未命中）单价
                    {{ currencySymbol(form.currency) }}/M</label
                  >
                  <NumberStepper v-model="form.inputPerMTok" :base="0.01" />
                </div>
                <div class="flex flex-1 flex-col gap-1">
                  <label class="text-xs text-text-muted"
                    >输出单价 {{ currencySymbol(form.currency) }}/M</label
                  >
                  <NumberStepper v-model="form.outputPerMTok" :base="0.01" />
                </div>
              </div>

              <!-- 缓存命中 -->
              <div class="mt-3 flex items-center gap-2">
                <input
                  :id="'cache-hit-' + (editing || 'new')"
                  v-model="form.cacheHitEnabled"
                  type="checkbox"
                  class="h-3.5 w-3.5"
                />
                <label
                  :for="'cache-hit-' + (editing || 'new')"
                  class="text-xs text-text-dim"
                >
                  启用缓存命中价格（多数 Provider 支持命中按低价计费）
                </label>
              </div>
              <div v-if="form.cacheHitEnabled" class="mt-2 flex flex-col gap-1">
                <label class="text-xs text-text-muted"
                  >缓存命中单价 {{ currencySymbol(form.currency) }}/M</label
                >
                <NumberStepper v-model="form.cacheHitPerMTok" :base="0.001" />
              </div>

              <!-- 缓存写入（默认折叠/隐藏，按需开启） -->
              <div class="mt-3 flex items-center gap-2">
                <input
                  :id="'cache-write-' + (editing || 'new')"
                  v-model="form.cacheWriteEnabled"
                  type="checkbox"
                  class="h-3.5 w-3.5"
                />
                <label
                  :for="'cache-write-' + (editing || 'new')"
                  class="text-xs text-text-dim"
                >
                  启用缓存写入价格（仅 Anthropic 等少数模型存在写入计费）
                </label>
              </div>
              <div
                v-if="form.cacheWriteEnabled"
                class="mt-2 flex flex-col gap-1"
              >
                <label class="text-xs text-text-muted"
                  >缓存写入单价 {{ currencySymbol(form.currency) }}/M</label
                >
                <NumberStepper v-model="form.cacheWritePerMTok" :base="0.01" />
              </div>
            </div>

            <!-- 错误提示 -->
            <div
              v-if="errorMsg"
              class="rounded-md bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {{ errorMsg }}
            </div>

            <!-- 操作按钮 -->
            <div class="flex justify-end gap-2 pt-1">
              <button
                type="button"
                class="rounded-lg px-3 py-1.5 text-sm text-text-dim hover:bg-bg-hover hover:text-text-main"
                :disabled="saving"
                @click="cancelEdit"
              >
                取消
              </button>
              <button
                type="button"
                class="rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                :disabled="saving"
                @click="save"
              >
                {{ saving ? "保存中…" : "保存" }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
