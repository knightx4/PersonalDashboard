import 'server-only';

import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  type LinkTokenCreateRequest,
  type Products,
} from 'plaid';
import { plaidEnv, type PlaidEnv } from './env';
import type { PlaidPort } from './link';

/** The Plaid API, keyed from the environment. */
export function plaidApi(env: PlaidEnv = plaidEnv()): PlaidApi {
  return new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments[env.PLAID_ENV],
      baseOptions: {
        headers: { 'PLAID-CLIENT-ID': env.PLAID_CLIENT_ID, 'PLAID-SECRET': env.PLAID_SECRET },
      },
    }),
  );
}

/**
 * Plaid's own words for a failed call: the message meant for the person when
 * it sends one, its technical message otherwise.
 */
export function plaidErrorMessage(error: unknown): string {
  const data = (error as { response?: { data?: { display_message?: string | null; error_message?: string; error_code?: string } } })
    ?.response?.data;
  if (data?.display_message) return data.display_message;
  if (data?.error_message) return data.error_message;
  if (data?.error_code) return `Plaid refused: ${data.error_code}.`;
  return error instanceof Error ? error.message : 'Plaid could not be reached.';
}

/** The calls linking makes, against the real API. */
export function plaidPort(api: PlaidApi = plaidApi()): PlaidPort {
  return {
    async createLinkToken(req) {
      const body: LinkTokenCreateRequest = {
        client_name: 'Dash',
        language: 'en',
        country_codes: [CountryCode.Us],
        user: { client_user_id: req.userId },
      };
      if (req.accessToken) {
        body.access_token = req.accessToken;
      } else {
        body.products = (req.products ?? []) as Products[];
        if (req.optionalProducts?.length) body.optional_products = req.optionalProducts as Products[];
        if (req.webhook) body.webhook = req.webhook;
      }
      if (req.redirectUri) body.redirect_uri = req.redirectUri;
      const { data } = await api.linkTokenCreate(body);
      return data.link_token;
    },
    async exchange(publicToken) {
      const { data } = await api.itemPublicTokenExchange({ public_token: publicToken });
      return { accessToken: data.access_token, itemId: data.item_id };
    },
    async getItem(accessToken) {
      const { data } = await api.itemGet({ access_token: accessToken });
      return {
        institutionId: data.item.institution_id ?? null,
        institutionName: data.item.institution_name ?? null,
        errorCode: data.item.error?.error_code ?? null,
        errorMessage: data.item.error?.display_message ?? data.item.error?.error_message ?? null,
      };
    },
    async getAccounts(accessToken) {
      const { data } = await api.accountsGet({ access_token: accessToken });
      return data.accounts.map((a) => ({
        account_id: a.account_id,
        name: a.name,
        official_name: a.official_name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        balances: {
          current: a.balances.current,
          available: a.balances.available,
          limit: a.balances.limit,
          iso_currency_code: a.balances.iso_currency_code,
        },
      }));
    },
    async removeItem(accessToken) {
      await api.itemRemove({ access_token: accessToken });
    },
  };
}
