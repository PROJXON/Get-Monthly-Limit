import { authenticate } from "../shopify.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, admin } = await authenticate.webhook(request);
  if (!admin) throw new Response("Unauthorized", { status: 401 });

  const orderId = payload.id.toString();
  const shopData = await admin.graphql(`
    {
      shop {
        id
        monthlyLimit: metafield(namespace: "custom", key: "monthly_limit") { value }
        queueTotal: metafield(namespace: "custom", key: "queue_total") { value }
        fulfillmentMonth: metafield(namespace: "custom", key: "fulfillment_month") { value }
        processedOrders: metafield(namespace: "custom", key: "processed_orders") { value }
      }
    }
  `);

  const shopJson = await shopData.json();
  const shop = shopJson.data.shop;
  const shopId = shop.id;

  let processedOrders: string[] = shop.processedOrders?.value
    ? shop.processedOrders.value.split(",")
    : [];

  if (processedOrders.includes(orderId)) return new Response();

  let totalQuantity = 0;
  for (const item of payload.line_items) totalQuantity += item.quantity;

  const monthlyLimit = parseInt(shop.monthlyLimit?.value || "0");
  if (monthlyLimit <= 0) throw new Error("monthly_limit must be set and > 0");

  let queueTotal = parseInt(shop.queueTotal?.value || "0");
  let fulfillmentMonth = shop.fulfillmentMonth?.value || getCurrentMonth();
  const currentMonth = getCurrentMonth();

  let safety = 0;
  while (fulfillmentMonth !== currentMonth && safety < 24) {
    queueTotal = Math.max(queueTotal - monthlyLimit, 0);
    fulfillmentMonth = incrementMonth(fulfillmentMonth);
    safety++;
  }

  queueTotal += totalQuantity;
  processedOrders.push(orderId);

  if (processedOrders.length > 500)
    processedOrders = processedOrders.slice(-500);

  const processedOrdersString = processedOrders.join(",");

  const result = await admin.graphql(`
    mutation {
      metafieldsSet(metafields: [
        {
          namespace: "custom",
          key: "queue_total",
          type: "number_integer",
          value: "${queueTotal}",
          ownerId: "${shopId}"
        },
        {
          namespace: "custom",
          key: "fulfillment_month",
          type: "single_line_text_field",
          value: "${fulfillmentMonth}",
          ownerId: "${shopId}"
        },
        {
          namespace: "custom",
          key: "processed_orders",
          type: "single_line_text_field",
          value: "${processedOrdersString}",
          ownerId: "${shopId}"
        }
      ]) {
        userErrors { message }
      }
    }
  `);

  const json = await result.json();
  if (json.data.metafieldsSet.userErrors.length) {
    console.error("Metafield errors:", json.data.metafieldsSet.userErrors);
  }

  return new Response();
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function incrementMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
