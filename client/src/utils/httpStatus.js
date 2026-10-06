// HTTP status code catalog used by the status pages and the /status reference.
// `tyllage` lists the API error codes Tyllage actually returns with that status.

export const CATEGORIES = {
  1: { label: 'Informational', tone: 'info', blurb: 'Protocol-level information while a request is still in progress.' },
  2: { label: 'Success', tone: 'low', blurb: 'The request was received, understood and accepted.' },
  3: { label: 'Redirection', tone: 'primary', blurb: 'The client must take another step, usually following a new location.' },
  4: { label: 'Client error', tone: 'medium', blurb: 'Something about the request needs to change before it can succeed.' },
  5: { label: 'Server error', tone: 'high', blurb: 'The server failed to complete a valid request.' },
};

// [code, reason phrase, summary, tag?]
const RAW = [
  [100, 'Continue', 'The first part of the request was received; the client can send the rest.'],
  [101, 'Switching Protocols', 'The server agrees to switch to the protocol named in the Upgrade header.'],
  [102, 'Processing', 'The server is working on the request but has no response yet.', 'WebDAV'],
  [103, 'Early Hints', 'Lets the browser start preloading linked resources before the final response.'],

  [200, 'OK', 'The request succeeded.'],
  [201, 'Created', 'The request succeeded and a new resource was created.'],
  [202, 'Accepted', 'The request was accepted for processing but has not finished yet.'],
  [203, 'Non-Authoritative Information', 'The returned metadata came from a copy, not the origin server.'],
  [204, 'No Content', 'The request succeeded and there is no body to return.'],
  [205, 'Reset Content', 'The client should reset the document or form that sent the request.'],
  [206, 'Partial Content', 'Only the byte range requested with a Range header is returned.'],
  [207, 'Multi-Status', 'Several operations ran; each one’s status is in the response body.', 'WebDAV'],
  [208, 'Already Reported', 'The resource was already listed earlier in the same response body.', 'WebDAV'],
  [226, 'IM Used', 'The response is the result of instance manipulations applied to the resource.'],

  [300, 'Multiple Choices', 'There are several possible responses; the client should pick one.'],
  [301, 'Moved Permanently', 'The resource has a new permanent URL, given in the Location header.'],
  [302, 'Found', 'The resource is temporarily at another URL, given in the Location header.'],
  [303, 'See Other', 'The result is available at another URL and should be fetched with GET.'],
  [304, 'Not Modified', 'The cached copy is still valid; no new body is sent.'],
  [305, 'Use Proxy', 'The resource must be accessed through a proxy.', 'Deprecated'],
  [306, 'Unused', 'Reserved; no longer used.', 'Unused'],
  [307, 'Temporary Redirect', 'Temporarily elsewhere — repeat the request there with the same method.'],
  [308, 'Permanent Redirect', 'Permanently elsewhere — repeat the request there with the same method.'],

  [400, 'Bad Request', 'The request is malformed or fails validation and should not be retried unchanged.'],
  [401, 'Unauthorized', 'Authentication is missing, expired or invalid.'],
  [402, 'Payment Required', 'Reserved for future use with digital payment systems.', 'Experimental'],
  [403, 'Forbidden', 'The client is known but does not have permission for this resource.'],
  [404, 'Not Found', 'The requested resource does not exist.'],
  [405, 'Method Not Allowed', 'The HTTP method is not supported for this resource.'],
  [406, 'Not Acceptable', 'No representation matches the Accept headers the client sent.'],
  [407, 'Proxy Authentication Required', 'The client must authenticate with the proxy first.'],
  [408, 'Request Timeout', 'The server did not receive the full request in time.'],
  [409, 'Conflict', 'The request conflicts with the current state of the resource.'],
  [410, 'Gone', 'The resource existed but has been permanently removed.'],
  [411, 'Length Required', 'The request must include a Content-Length header.'],
  [412, 'Precondition Failed', 'A condition in the request headers was not met.'],
  [413, 'Payload Too Large', 'The request body exceeds the server’s size limit.'],
  [414, 'URI Too Long', 'The requested URL is longer than the server will process.'],
  [415, 'Unsupported Media Type', 'The request body’s Content-Type is not supported.'],
  [416, 'Range Not Satisfiable', 'The requested byte range cannot be served.'],
  [417, 'Expectation Failed', 'The server cannot meet the Expect request header.'],
  [418, 'I’m a teapot', 'An April Fools’ code from RFC 2324; sometimes used to refuse automated requests.', 'RFC 2324'],
  [420, 'Enhance Your Calm', 'A legacy Twitter API code for rate limiting.', 'Twitter'],
  [422, 'Unprocessable Content', 'The syntax is fine, but the content cannot be processed.', 'WebDAV'],
  [423, 'Locked', 'The resource is locked.', 'WebDAV'],
  [424, 'Failed Dependency', 'The request failed because an earlier request it depended on failed.', 'WebDAV'],
  [425, 'Too Early', 'The server won’t risk processing a request that might be replayed.'],
  [426, 'Upgrade Required', 'The client must switch to a different protocol.'],
  [428, 'Precondition Required', 'The server requires the request to be conditional.'],
  [429, 'Too Many Requests', 'The client has sent too many requests in a short time (rate limiting).'],
  [431, 'Request Header Fields Too Large', 'The request headers are too large to process.'],
  [444, 'No Response', 'Nginx closed the connection without sending a response.', 'Nginx'],
  [449, 'Retry With', 'The request should be retried after the client performs the appropriate action.', 'Microsoft'],
  [450, 'Blocked by Windows Parental Controls', 'Windows Parental Controls blocked access.', 'Microsoft'],
  [451, 'Unavailable For Legal Reasons', 'The resource cannot be provided for legal reasons.'],
  [499, 'Client Closed Request', 'Nginx: the client closed the connection before a response was sent.', 'Nginx'],

  [500, 'Internal Server Error', 'The server hit an unexpected condition.'],
  [501, 'Not Implemented', 'The server does not support the functionality required.'],
  [502, 'Bad Gateway', 'An upstream server returned an invalid response.'],
  [503, 'Service Unavailable', 'The server is temporarily unable to handle requests.'],
  [504, 'Gateway Timeout', 'An upstream server did not respond in time.'],
  [505, 'HTTP Version Not Supported', 'The HTTP version in the request is not supported.'],
  [506, 'Variant Also Negotiates', 'A server configuration error in content negotiation.', 'Experimental'],
  [507, 'Insufficient Storage', 'The server cannot store what is needed to complete the request.', 'WebDAV'],
  [508, 'Loop Detected', 'The server detected an infinite loop while processing.', 'WebDAV'],
  [510, 'Not Extended', 'Further extensions to the request are required.'],
  [511, 'Network Authentication Required', 'The client must authenticate to gain network access (e.g. a captive portal).'],
];

// Codes the Tyllage API returns, with the machine-readable `code` values in the error body.
const TYLLAGE_USAGE = {
  200: ['Successful reads, updates and actions'],
  201: ['Register, harvest, produce, demand, Rescue listing, reservation, campaign draft'],
  400: ['VALIDATION_ERROR', 'INVALID_JSON', 'PRODUCE_FARM_MISMATCH', 'INVALID_REFERENCE'],
  401: ['UNAUTHORIZED', 'INVALID_TOKEN', 'INVALID_CREDENTIALS', 'ACCOUNT_INACTIVE'],
  403: ['FORBIDDEN', 'FARM_ACCESS_DENIED', 'FARM_ADMIN_REQUIRED'],
  404: ['NOT_FOUND', 'ROUTE_NOT_FOUND'],
  409: ['OVER_ALLOCATION', 'DEMAND_EXCEEDED', 'INVALID_TRANSITION', 'DUPLICATE', 'MATCH_NOT_PENDING', 'BATCH_CLOSED'],
  413: ['PAYLOAD_TOO_LARGE (JSON body over 100kb)'],
  415: ['UNSUPPORTED_MEDIA_TYPE (write requests must be JSON)'],
  429: ['RATE_LIMITED'],
  500: ['INTERNAL_ERROR (details hidden in production)'],
  503: ['GET /api/health when the database is unreachable'],
};

// User-facing copy for the codes people actually meet in the app.
const FRIENDLY = {
  200: ['All good', 'The request completed successfully.'],
  201: ['Created', 'Your new record was saved.'],
  202: ['Accepted', 'We’ve received your request and are working on it.'],
  204: ['Done', 'The action completed. There’s nothing more to show.'],
  301: ['This page has moved', 'The address has changed permanently. Update any bookmarks.'],
  302: ['This page has moved', 'The content is temporarily at another address.'],
  304: ['Nothing new', 'Your saved copy is still up to date.'],
  400: ['That request didn’t look right', 'Some information was missing or invalid. Check what you entered and try again.'],
  401: ['Please sign in', 'Your session has ended or you aren’t signed in yet.'],
  402: ['Payment required', 'Payments aren’t part of the Tyllage pilot yet.'],
  403: ['You don’t have access', 'Your account doesn’t have permission for this page. If that seems wrong, ask your farm or platform admin.'],
  404: ['Page not found', 'We couldn’t find what you were looking for. It may have moved, been closed or never existed.'],
  405: ['Action not allowed', 'That action isn’t supported here.'],
  408: ['That took too long', 'The request timed out before it finished. Please try again.'],
  409: ['That clashes with a recent change', 'The record changed since you loaded it — for example, stock may already be allocated. Refresh and try again.'],
  410: ['No longer available', 'This item has been permanently removed — a Rescue listing may have expired or sold out.'],
  413: ['That’s too large', 'What you sent is bigger than we accept. Try sending less at once.'],
  415: ['Unsupported format', 'We couldn’t read the format of what was sent.'],
  418: ['I’m a teapot', 'This server politely refuses to brew coffee. You probably meant something else.'],
  422: ['We couldn’t process that', 'The details are readable but can’t be used as they are. Check them and try again.'],
  423: ['This is locked', 'Someone else is working on this right now. Try again shortly.'],
  429: ['Slow down a moment', 'You’ve made a lot of requests in a short time. Wait a minute, then try again.'],
  451: ['Unavailable for legal reasons', 'This content can’t be provided in your region.'],
  500: ['Something went wrong on our side', 'The problem has been logged. Please try again in a moment.'],
  501: ['Not available yet', 'This feature isn’t part of the current Tyllage pilot.'],
  502: ['Connection problem', 'A service Tyllage depends on sent an invalid response. Please try again.'],
  503: ['Tyllage is temporarily unavailable', 'We may be updating, or the server can’t be reached. Please try again shortly.'],
  504: ['A service took too long', 'A service Tyllage depends on didn’t respond in time. Please try again.'],
};

const CATEGORY_FALLBACK = {
  1: ['Request in progress', 'The server is still handling this request.'],
  2: ['All good', 'The request completed successfully.'],
  3: ['This has moved', 'The content is available at a different address.'],
  4: ['We couldn’t complete that request', 'Something about the request needs to change before it can succeed.'],
  5: ['Server error', 'The server couldn’t complete a valid request. Please try again later.'],
};

export const STATUS_CODES = RAW.map(([code, name, summary, tag]) => ({
  code,
  name,
  summary,
  tag: tag || null,
  category: Math.floor(code / 100),
  tyllage: TYLLAGE_USAGE[code] || null,
}));

const BY_CODE = new Map(STATUS_CODES.map((s) => [s.code, s]));

/** Full description for a code; unknown codes fall back to their category. */
export function getStatus(code) {
  const n = Number(code);
  const category = Math.floor(n / 100);
  const known = BY_CODE.get(n);
  if (!known && !CATEGORIES[category]) return null;
  const [title, message] = FRIENDLY[n] || CATEGORY_FALLBACK[category];
  return {
    ...(known || { code: n, name: 'Unknown status', summary: 'A non-standard status code.', tag: 'Non-standard', category, tyllage: null }),
    title,
    message,
    categoryInfo: CATEGORIES[category],
  };
}

/** Codes where retrying the same request may succeed. */
export const isRetryable = (code) => [408, 425, 429, 500, 502, 503, 504].includes(Number(code)) || Number(code) === 0;
