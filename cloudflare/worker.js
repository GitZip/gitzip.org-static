export default {
    async fetch(request, env) {
      const url = new URL(request.url);
      const cookieHeader = request.headers.get("Cookie") || "";
      const cookies = Object.fromEntries(
        cookieHeader.split("; ").filter(Boolean).map(v => v.split("="))
      );

      const isProd = url.hostname == "gitzip.org";
      const callback = await env.SECRETS.get("github_callback" + (isProd ? "" : "_dev"));
      const client_id = await env.SECRETS.get("github_client_id" + (isProd ? "" : "_dev"));
      const client_secret = await env.SECRETS.get("github_client_secret" + (isProd ? "" : "_dev"));
      const site_baseurl = await env.SECRETS.get("site_baseurl" + (isProd ? "" : "_dev"));
  
      function getAuthorizeUrlByScope(scope){
        return 'https://github.com/login/oauth/authorize?' + 
            [
                'scope=' + scope, 
                'client_id=' + client_id, 
                'redirect_uri=' + encodeURIComponent(callback)
            ].join('&');
      }

      function internalError(message) {
        return new Response(message, { status: 500 });
      }

      function notFound() {
        return new Response("Not Found", { status: 404 });
      }

      let isNewSession = false;
      let sessionId = cookies.session_id;
      if (!sessionId) {
        sessionId = crypto.randomUUID();
        isNewSession = true;
      }

      const keyBackto = `${sessionId}-backto`;
      const keyApitoken = `${sessionId}-apitoken`;
  
      let referrer = '';
      let scope = '';
      if (url.pathname.startsWith("/gettoken/authorize/private/")) {
        const paths = url.pathname.split('/');
        if (paths.length == 5) {
            referrer = decodeURIComponent( paths[4] );
            scope = 'repo';
        }
      } else if (url.pathname.startsWith("/gettoken/authorize/")) {
        const paths = url.pathname.split('/');
        if (paths.length == 4) {
            referrer = decodeURIComponent( paths[3] );
            scope = 'public_repo';
        }
      }

      if (referrer && scope) {
            await env.SESSIONS.put(keyBackto, referrer, { expirationTtl: 3600 });
            const redirectHeader = {
                'Location': getAuthorizeUrlByScope(scope)
            };
            if (isNewSession) redirectHeader['Set-Cookie'] = `session_id=${sessionId};max-age=604800;Path=/`;
            // return Response.redirect(getAuthorizeUrlByScope(scope), 302);
            return new Response(null, {
                status: 302,
                headers: redirectHeader
            });
      }

      if (url.pathname === "/gettoken/callback") {
        const code = url.searchParams.get("code");
        if (code) {
            const githubOAuthUrl = "https://github.com/login/oauth/access_token";
            const headers = new Headers({
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            });
            const bodyText = JSON.stringify({
                "code" : code,
                "client_id" : client_id,
                "client_secret" : client_secret
            });

            const githubOAuthRequest = new Request(githubOAuthUrl, {
                method: "POST",
                headers: headers,
                body: bodyText
            });

            const githubOAuthResponse = await fetch(githubOAuthRequest);
            if (githubOAuthResponse.ok) {
                const resJson = await githubOAuthResponse.json();
                if(resJson.access_token){
                    await env.SESSIONS.put(keyApitoken, resJson.access_token, { expirationTtl: 3600 });
                    const tmpUrl = new URL(request.url);
                    tmpUrl.pathname = '/gettoken/success';
                    tmpUrl.search = "";
                    return Response.redirect(tmpUrl, 302);
                }
            }
            return internalError(await githubOAuthResponse.text());
        }
      }

      if (url.pathname === "/gettoken/success") {
        const backto = await env.SESSIONS.get(keyBackto);
        const apitoken = await env.SESSIONS.get(keyApitoken);
        const pageRes = await fetch("https://gitzip-org-static.pages.dev/_tpl/goback.ejs");
        let html = await pageRes.text();

        html = html.replaceAll("<%= base %>", site_baseurl);
        html = html.replaceAll("<%= token %>", apitoken);
        html = html.replaceAll("<%= link %>", backto);

        return new Response(html, {
          headers: { "Content-Type": "text/html" }
        });
      }

      return notFound();
    },
  };