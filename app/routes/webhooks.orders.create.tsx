import { authenticate } from "../shopify.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, admin } = await authenticate.webhook(request);
  if (!admin) throw new Response("Unauthorized", { status: 401 });

  let totalQuantity = 0;
  for (const item of payload.line_items) {
    totalQuantity += item.quantity;
  }

  const shopData = await admin.graphql(`
    {
      shop {
        id
        monthlyLimit: metafield(namespace: "custom", key: "monthly_limit") { value }
        queueTotal: metafield(namespace: "custom", key: "queue_total") { value }
        fulfillmentMonth: metafield(namespace: "custom", key: "fulfillment_month") { value }
      }
    }
  `);

  const shopJson = await shopData.json();
  const shop = shopJson.data.shop;

  const shopId = shop.id;
  const monthlyLimit = parseInt(shop.monthlyLimit?.value || "0");
  let queueTotal = parseInt(shop.queueTotal?.value || "0");
  let fulfillmentMonth = shop.fulfillmentMonth?.value || getCurrentMonth();

  const currentMonth = getCurrentMonth();

  while (fulfillmentMonth !== currentMonth) {
    queueTotal = Math.max(queueTotal - monthlyLimit, 0);
    fulfillmentMonth = incrementMonth(fulfillmentMonth);
  }

  queueTotal += totalQuantity;

  await admin.graphql(`
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
        }
      ]) {
        userErrors { message }
      }
    }
  `);

  return new Response();
};

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function incrementMonth(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(year, m); // JS auto-rolls year
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
