import * as dotenv from 'dotenv';
dotenv.config();
import * as MQTTBroker from 'async-mqtt';
import Ewelink from 'ewelink-api';
import fetch from 'node-fetch';

type Bind = [string, number] | { [s: string]: 'on' | 'off' };

interface ICfg {
    to: Bind[];
    from: string[][];
}

interface IRF {
    Time: string;
    RfReceived: {
        Sync: number;
        Low: number;
        High: number;
        Data: string;
        RfKey: string;
    };
}

const mqtt = MQTTBroker.connect(process.env.MQTT_URL, {
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD
});

const ewe = new Ewelink({
    region: process.env.EWELINK_REGION || 'eu',
    email: process.env.EWELINK_EMAIL,
    password: process.env.EWELINK_PASSWORD,
});

async function loadCodes(): Promise<[ICfg, Map<string, number>]> {
    const codeMap = new Map<string, number>();
    const res = await fetch(process.env.CONFIG_URL);
    const cfg = await res.json() as ICfg;
    cfg.from.map((codeArr: string[], i: number) => {
        codeArr.map(code => codeMap.set(code, i));
    });
    console.log('Codes loaded!');
    return [cfg, codeMap];
}

async function main() {
    const [cfg, codeMap] = await loadCodes();
    console.log('Logged');
    await mqtt.subscribe('tele/tasmota/#');
    mqtt.on('message', async (topic: string, payload: Buffer, packet: MQTTBroker.Packet) => {
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
        console.log();
    });
}

main();
