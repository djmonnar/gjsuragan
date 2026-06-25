# Logen Open API setup

This project calls Logen from Firebase Functions only. Do not put `secretKey`
in `admin.html` or any public frontend file.

## Current integration mode

- Output mode: iLOGEN output
- Order registration: `/lrm02b-edi/edi/registerOrderData`
- Slip number inquiry: `/lrm02b-edi/edi/inquirySlipNoMulti`
- Customer order number field: `fixTakeNo`
- Default fare type: `030` credit
- Sender fields: fixed GJSURAGAN business information

## Function environment variables

Set these in the Functions environment. For local Firebase deploys, put them in
the ignored file `functions/.env.gjsuragan-60505`.

```env
LOGEN_ENV=test
LOGEN_SECRET_KEY=...
LOGEN_USER_ID=58020072
LOGEN_CUST_CD=58020072
LOGEN_SENDER_NAME=궁중수라간
LOGEN_SENDER_PHONE=01035071278
LOGEN_SENDER_ADDRESS=경상남도 진주시 동진로107번길 8 2층
LOGEN_FARE_TY=030
LOGEN_DLV_FARE=...
LOGEN_DRY_RUN=false
```

Optional:

```env
LOGEN_API_BASE_URL=https://topenapi.ilogen.com/lrm02b-edi/edi
LOGEN_SENDER_CELL_PHONE=01035071278
LOGEN_BOX_TY_CD=...
```

## API endpoints

Development:

- `https://topenapi.ilogen.com/lrm02b-edi/edi/registerOrderData`
- `https://topenapi.ilogen.com/lrm02b-edi/edi/inquirySlipNoMulti`
- `https://topenapi.ilogen.com/lrm02b-edi/edi/contPickFares`

Production:

- `https://openapi.ilogen.com/lrm02b-edi/edi/registerOrderData`
- `https://openapi.ilogen.com/lrm02b-edi/edi/inquirySlipNoMulti`
- `https://openapi.ilogen.com/lrm02b-edi/edi/contPickFares`

## Whitelist IP

Logen checks both the caller IP and `secretKey`. Default Firebase Functions
egress IPs are not static. Before real Logen testing, configure a static egress
IP, for example:

1. Serverless VPC Access connector
2. Cloud NAT with a reserved static external IP
3. Route the `api` function egress through that connector
4. Send the static IP to Logen for development whitelist registration

Until the IP is whitelisted, real calls can fail with `401 Unauthorized` even
when the `secretKey` is correct.

## Security note

If a Logen TEST or LIVE key is exposed in chat, screenshots, commits, or logs,
reissue it from Logen Open API before production use.
