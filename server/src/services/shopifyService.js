const axios = require('axios');
const { URL } = require('url');
const Customer = require('../models/Customer');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Event = require('../models/Event');

const DEFAULT_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

// Normalize and validate the provided shop domain.
const normalizeShopDomain = (rawDomain) => {
  if (!rawDomain) return null;
  const trimmed = String(rawDomain).trim();
  let host;

  try {
    const url = trimmed.includes('://') ? new URL(trimmed) : new URL(`https://${trimmed}`);
    host = url.hostname.toLowerCase();
  } catch (err) {
    return null;
  }

  // If someone enters only the shop subdomain (e.g., "my-store"), default to Shopify's hostname.
  if (host && !host.includes('.')) {
    host = `${host}.myshopify.com`;
  }

  // Require the Admin hostname; custom storefront domains won't work with the Admin API.
  if (!host.endsWith('.myshopify.com')) {
    return null;
  }

  return host;
};

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return undefined;
  const num = Number(value);
  return Number.isNaN(num) ? undefined : num;
};

const normalizeTags = (tags) => {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => t.trim()).filter(Boolean);
  return String(tags)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
};

const clientForShop = (shop) => {
  const domain = normalizeShopDomain(shop.shopDomain);
  if (!domain) {
    throw new Error('Invalid shop domain. Provide a hostname like "your-store.myshopify.com".');
  }

  return axios.create({
    baseURL: `https://${domain}/admin/api/${shop.apiVersion || DEFAULT_API_VERSION}/`,
    headers: {
      'X-Shopify-Access-Token': shop.accessToken,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
};

const parsePageInfo = (linkHeader) => {
  if (!linkHeader) return null;
  const nextLink = linkHeader.split(',').find((part) => part.includes('rel="next"'));
  if (!nextLink) return null;
  const urlPart = nextLink.split(';')[0].trim().replace(/[<>]/g, '');
  try {
    const url = new URL(urlPart);
    return url.searchParams.get('page_info');
  } catch (err) {
    return null;
  }
};

const buildShopifyError = (err, domain, resourcePath) => {
  const status = err.response?.status;
  const statusText = err.response?.statusText;
  const errors = err.response?.data?.errors || err.response?.data;
  const detail = errors ? JSON.stringify(errors) : err.message;
  const hint =
    status === 404
      ? 'Verify the shop domain is the Admin hostname (e.g. your-store.myshopify.com) and the token has access.'
      : status === 401 || status === 403
        ? 'Check the Admin API token and scopes for customers/orders/products.'
        : '';

  const message = [`Shopify ${status || ''} ${statusText || ''} for ${domain} ${resourcePath}: ${detail}`, hint]
    .filter(Boolean)
    .join(' - ')
    .trim();

  const enhancedError = new Error(message);
  enhancedError.status = status;
  enhancedError.statusText = statusText;
  enhancedError.response = err.response;
  enhancedError.shopDomain = domain;
  enhancedError.resourcePath = resourcePath;
  return enhancedError;
};

// Quick connectivity check to ensure the domain/token pair is valid and capture the canonical myshopify domain.
const verifyShopCredentials = async (shop) => {
  const normalizedDomain = normalizeShopDomain(shop.shopDomain);
  if (!normalizedDomain) {
    throw new Error('Invalid shop domain. Provide a hostname like "your-store.myshopify.com".');
  }

  const client = clientForShop({
    ...shop,
    shopDomain: normalizedDomain,
    apiVersion: shop.apiVersion || DEFAULT_API_VERSION,
  });

  try {
    const response = await client.get('shop.json');
    const canonicalDomain = response?.data?.shop?.myshopify_domain?.toLowerCase() || normalizedDomain;
    return { canonicalDomain, shop: response?.data?.shop };
  } catch (err) {
    throw buildShopifyError(err, normalizedDomain, 'shop');
  }
};

const fetchPaginatedResource = async (shop, resourcePath, dataKey, params = {}) => {
  const domain = normalizeShopDomain(shop.shopDomain);
  const client = clientForShop(shop);
  const records = [];
  let pageInfo;

  do {
    try {
      const response = await client.get(`${resourcePath}.json`, {
        params: {
          limit: 250,
          ...params,
          ...(pageInfo ? { page_info: pageInfo } : {}),
        },
      });

      const payload = response.data[dataKey] || [];
      records.push(...payload);
      pageInfo = parsePageInfo(response.headers.link);
    } catch (err) {
      throw buildShopifyError(err, domain, resourcePath);
    }
  } while (pageInfo);

  return records;
};

const resourceConfig = {
  customers: {
    path: 'customers',
    dataKey: 'customers',
    model: Customer,
    map: (customer, shopId) => ({
      shop: shopId,
      shopifyId: String(customer.id),
      email: customer.email,
      phone: customer.phone,
      firstName: customer.first_name,
      lastName: customer.last_name,
      tags: normalizeTags(customer.tags),
      totalSpent: toNumber(customer.total_spent),
      state: customer.state,
      country: customer.default_address?.country_code,
      marketingOptInLevel: customer.marketing_opt_in_level,
      shopifyCreatedAt: customer.created_at,
      shopifyUpdatedAt: customer.updated_at,
    }),
  },
  orders: {
    path: 'orders',
    dataKey: 'orders',
    model: Order,
    params: { status: 'any' },
    map: (order, shopId) => ({
      shop: shopId,
      shopifyId: String(order.id),
      name: order.name,
      email: order.email,
      currency: order.currency,
      totalPrice: toNumber(order.total_price),
      subtotalPrice: toNumber(order.subtotal_price),
      totalDiscounts: toNumber(order.total_discounts),
      financialStatus: order.financial_status,
      fulfillmentStatus: order.fulfillment_status,
      processedAt: order.processed_at,
      tags: normalizeTags(order.tags),
      customer: order.customer
        ? {
            id: String(order.customer.id),
            email: order.customer.email,
            firstName: order.customer.first_name,
            lastName: order.customer.last_name,
          }
        : undefined,
      lineItems: (order.line_items || []).map((li) => ({
        shopifyId: String(li.id),
        productId: li.product_id ? String(li.product_id) : undefined,
        variantId: li.variant_id ? String(li.variant_id) : undefined,
        name: li.name,
        quantity: li.quantity,
        price: toNumber(li.price),
      })),
      shopifyCreatedAt: order.created_at,
      shopifyUpdatedAt: order.updated_at,
    }),
  },
  products: {
    path: 'products',
    dataKey: 'products',
    model: Product,
    map: (product, shopId) => ({
      shop: shopId,
      shopifyId: String(product.id),
      title: product.title,
      status: product.status,
      productType: product.product_type,
      vendor: product.vendor,
      tags: normalizeTags(product.tags),
      variants: (product.variants || []).map((variant) => ({
        shopifyId: String(variant.id),
        title: variant.title,
        sku: variant.sku,
        price: toNumber(variant.price),
        inventoryQuantity: variant.inventory_quantity,
      })),
      shopifyCreatedAt: product.created_at,
      shopifyUpdatedAt: product.updated_at,
    }),
  },
};

const upsertDocuments = async (Model, docs) => {
  if (!docs.length) return 0;

  const operations = docs.map((doc) => ({
    updateOne: {
      filter: { shop: doc.shop, shopifyId: doc.shopifyId },
      update: { $set: doc },
      upsert: true,
    },
  }));

  const result = await Model.bulkWrite(operations, { ordered: false });
  return (result.upsertedCount || 0) + (result.modifiedCount || 0) + (result.matchedCount || 0);
};

const syncShopResources = async (shop, resources = ['customers', 'orders', 'products']) => {
  const summary = {};
  for (const resource of resources) {
    const config = resourceConfig[resource];
    if (!config) {
      summary[resource] = { error: 'unsupported resource' };
      continue;
    }

    const raw = await fetchPaginatedResource(shop, config.path, config.dataKey, config.params);
    const docs = raw.map((item) => config.map(item, shop._id));
    const saved = await upsertDocuments(config.model, docs);
    summary[resource] = { pulled: raw.length, saved };
  }
  return summary;
};

const handleWebhook = async (topic, payload, shop) => {
  const normalizedTopic = topic.toLowerCase();
  await Event.create({ shop: shop._id, topic: normalizedTopic, payload });

  if (normalizedTopic.startsWith('customers/')) {
    const doc = resourceConfig.customers.map(payload, shop._id);
    await upsertDocuments(Customer, [doc]);
    return { handled: true, type: 'customer' };
  }

  if (normalizedTopic.startsWith('orders/')) {
    const doc = resourceConfig.orders.map(payload, shop._id);
    await upsertDocuments(Order, [doc]);
    return { handled: true, type: 'order' };
  }

  if (normalizedTopic.startsWith('products/')) {
    const doc = resourceConfig.products.map(payload, shop._id);
    await upsertDocuments(Product, [doc]);
    return { handled: true, type: 'product' };
  }

  // Cart / checkout events are persisted as generic events for analytics.
  if (
    normalizedTopic.startsWith('carts/') ||
    normalizedTopic.startsWith('checkouts/') ||
    normalizedTopic.includes('abandon') ||
    normalizedTopic.includes('cart')
  ) {
    return { handled: true, type: 'event-only' };
  }

  return { handled: false };
};

module.exports = {
  syncShopResources,
  handleWebhook,
  normalizeShopDomain,
  verifyShopCredentials,
};
