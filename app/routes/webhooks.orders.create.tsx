import { authenticate } from "../shopify.server";
import type { ActionFunctionArgs } from "react-router";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload, admin } = await authenticate.webhook(request);
  if (!admin) throw new Response("Unauthorized", { status: 401 });

  const order = payload;
  let totalQuantity = 0;

  for (const item of order.line_items) totalQuantity += item.quantity;

  const shopData = await admin.graphql(`
    {
      shop {
        id
        metafield(namespace: "custom", key: "current_month_sold") {
          value
        }
      }
    }
  `);

  const shopJson = await shopData.json();
  const shopId = shopJson.data.shop.id;
  const currentSold = parseInt(shopJson.data.shop.metafield?.value || "0");
  const newTotal = currentSold + totalQuantity;

  await admin.graphql(`
    mutation {
      metafieldsSet(metafields: [{
        namespace: "custom",
        key: "current_month_sold",
        type: "number_integer",
        value: "${newTotal}",
        ownerId: "${shopId}"
      }]) {
        metafields { id }
        userErrors { message }
      }
    }
  `);

  return new Response();
};
