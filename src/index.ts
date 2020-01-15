import * as dotenv from 'dotenv';
dotenv.config();
import * as MQTTBroker from 'async-mqtt';
import { eWeLink, Zeroconf } from 'ewelink-api';
import * as http from 'http';
import { IRF } from './types';
import { getArpTable, loadCodes } from './utils';

http.createServer((req, res) => {
    res.write('Hello World!');
    res.end();
}).listen(process.env.PORT);

const mqtt = MQTTBroker.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});

async function getDevices() {
    try {
        const devices = Zeroconf.loadCachedDevices();
        if (process.env.REFRESH_DEVICES !== 'true') { return devices; }
    } catch (error) {/* */}
    const ewe = new eWeLink({
        region: process.env.EWELINK_REGION || 'eu',
        email: process.env.EWELINK_EMAIL,
        password: process.env.EWELINK_PASSWORD,
    });
    await ewe.saveDevicesCache();
    return Zeroconf.loadCachedDevices();
}

async function main() {
    const [cfg, codeMap] = await loadCodes();
    console.log('[1/4] Codes loaded!');
    const arpTable = await getArpTable();
    console.log('[2/4] ARP table loaded!');
    const devicesCache = await getDevices();
    console.log('[3/4] Cached devices loaded!');
    const ewe = new eWeLink({arpTable, devicesCache});
    console.log('[4/4] Ready!');

    await mqtt.subscribe('tele/tasmota/#');
    mqtt.on('message', async (topic: string, payload: Buffer) => {
        if (topic !== 'tele/tasmota/RESULT') { return; }
        const msg = JSON.parse(payload.toString()) as IRF;
        const i = codeMap.get(msg.RfReceived.Data);
        const newState = cfg.to[i];
        console.log(i, newState, msg.RfReceived.Data);
        console.log(await (newState
            && (newState instanceof Array
                ? ewe.toggleDevice(...newState)
                : Promise.all(Object.entries(newState).map(ent => ewe.setDevicePowerState(ent[0], ent[1].toString())))
            )
        ));
    });
}

main();
