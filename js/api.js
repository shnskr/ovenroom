const API = {
  async _post(action, body = {}) {
    const res = await fetch(CONFIG.API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, ...body }),
    });
    return this._parse(res);
  },

  async _parse(res) {
    let data;
    try {
      data = await res.json();
    } catch (e) {
      throw new Error("서버 응답을 읽지 못했습니다. 웹앱 URL/배포 상태를 확인해 주세요.");
    }
    if (!data || data.ok !== true) {
      throw new Error((data && data.error) || "요청에 실패했습니다.");
    }
    return data.data;
  },

  getAvailability(dates) {
    return this._post("getAvailability", { dates });
  },
  getPricing() {
    return this._post("getPricing");
  },
  createReservation(payload) {
    return this._post("createReservation", payload);
  },
  getCreditBalance(name, phone4) {
    return this._post("getCreditBalance", { name, phone4 });
  },
  getReservations(auth, from, to, status) {
    return this._post("getReservations", { adminId: auth.id, password: auth.pw, from, to, status });
  },
  setStatus(auth, id, status) {
    return this._post("updateStatus", { adminId: auth.id, password: auth.pw, id, status });
  },
  updateProfile(auth, changes) {
    return this._post("updateProfile", { adminId: auth.id, password: auth.pw, ...changes });
  },
};
