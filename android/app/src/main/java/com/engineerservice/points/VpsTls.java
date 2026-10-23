package com.engineerservice.points;

import java.net.HttpURLConnection;
import java.security.MessageDigest;
import javax.net.ssl.HttpsURLConnection;

/** IP connection: retain system CA/expiry validation and require the verified VPS public key. */
final class VpsTls {
    private static final String IP="107.173.154.48";
    private static final String PIN="hAk+m9YtW+YthKAoK3ZstV/hGf1egqiZg0N1Ln42K7c=";
    static void configure(HttpURLConnection connection) {
        if (!(connection instanceof HttpsURLConnection) || !IP.equals(connection.getURL().getHost()) || connection.getURL().getPort()!=10443) return;
        ((HttpsURLConnection)connection).setHostnameVerifier((host,session)->{
            if (!IP.equals(host)) return false;
            try {
                byte[] digest=MessageDigest.getInstance("SHA-256").digest(session.getPeerCertificates()[0].getPublicKey().getEncoded());
                return MessageDigest.isEqual(digest,android.util.Base64.decode(PIN,android.util.Base64.DEFAULT));
            } catch(Exception e) { return false; }
        });
    }
    private VpsTls() {}
}
