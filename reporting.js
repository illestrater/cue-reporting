require('dotenv').config();

const ENV = process.env;
const fs = require('fs');
const winston = require('winston');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const Json2csvParser = require('json2csv').Parser;

// const express = require('express');
// const https = require('https');
// const cors = require('cors');
// const bodyParser = require('body-parser');

const vaultOptions = {
    apiVersion: 'v1',
    endpoint: 'https://env.cue.dj:8200',
    token: fs.readFileSync(ENV.VAULT_TOKEN, 'utf8').trim()
};

const Vault = require('node-vault')(vaultOptions);
const models = require('./models');

Vault.read('secret/env').then(vault => {
    const secrets = vault.data;
    const SERVICE_KEY = secrets.service_key;
    const SOUNDEXCHANGE_KEY = fs.readFileSync(ENV.SOUNDEXCHANGE, 'utf8').trim();

    let Set;
    let initialized = false;
    const initialize = setInterval(() => {
        models.initialize().then(() => {
            mongoose.connect(secrets.mongo_driver);

            Set = mongoose.model('Set');
            initialized = true;
            clearInterval(initialize);
        });
    }, 2000);

    const logger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' })
    ]
    });

    logger.add(new winston.transports.Console({
        format: winston.format.simple()
    }));

    async function checkISRC(isrc) {
        const obj = {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'x-api-key': SOUNDEXCHANGE_KEY
            },
            body: JSON.stringify({
                searchFields: { isrc }
            })
        };

        return fetch('https://api.soundexchange.com/repertoire/v1_0/recordings/search', obj)
    }

    function generateReport() {
        const startDate = moment().startOf('month');
        const endDate = moment().endOf('month');

        Set.find({ $and: [
            { startTime: { $gte: startDate } },
            { endTime: { $lte: endDate } }
        ] }, (err2, sets) => {
            const fields = ['NAME_OF_SERVICE', 'FEATURED_ARTIST', 'SOUND_RECORDING_TITLE', 'ISRC', 'ACTUAL_TOTAL_PERFORMANCES'];
            const tracks = [];
            sets.forEach(set => {
                let count = 0;
                set.tracks.forEach(track => {
                    if (track.track.isrc && track.listenCount > 0) {
                        setTimeout(() => {
                            const foundISRC = checkISRC(track.track.isrc);
                            foundISRC.then((res) => {
                                console.log('FOUND ISRC', foundISRC);
                                const isrc = res.json();
                                if (isrc[0] && isrc[0].isrc) {
                                    tracks.push({
                                        NAME_OF_SERVICE: 'CUE Music',
                                        FEATURED_ARTIST: track.track.artist,
                                        SOUND_RECORDING_TITLE: track.track.title,
                                        ISRC: track.track.isrc,
                                        ACTUAL_TOTAL_PERFORMANCES: track.listenCount,
                                    });
                                }
                            });
                        }, count);
                        count += 1000;
                    }
                });
            });

            const json2csvParser = new Json2csvParser({ fields });
            const csv = json2csvParser.parse(tracks);

            fs.writeFile(`./reports/SoundExchangeROU-${ startDate.month() + 1 }-${ startDate.format('YYYY') }.csv`, csv, (err) => {
                if (err) console.log(err);
                console.log('REPORT CREATED!');
            });

            // res.attachment(`SoundExchangeROU${ req.body.month }-${ req.body.year }`);
            // res.type('csv');
            // return res.send(csv);
        }).select('tracks')
        .populate({
            path:   'tracks.track',
        });
    }


    // Notify room subscribers every morning of upcoming sets, check every 15 minutes
    const interval = 15 * 60 * 1000;
    const timeUntilInterval = 15 - Number(moment(Math.ceil(Date.parse(new Date()) % interval)).format('mm'));
    setTimeout(() => {
        console.log(`generating report in ${ timeUntilInterval } minutes`);
        if (initialized) generateReport();
        setInterval(() => {
            console.log('generating report...');
        }, 60000 * 15);
    }, 5000); // timeUntilInterval * 100);

    // function verify(token, res, callback) {
    //     try {
    //         const verified = jwt.verify(token.jwt, SERVICE_KEY);
    //         return callback(verified);
    //     } catch (err) {
    //         return res.status(500).json('Authorization error');
    //     }
    // }

    // const app = express();
    // app.use(cors());
    // app.use(bodyParser.json());

    // app.get('/status', (req, res) => {
    //     res.json({
    //         status: initialized ? 'online' : 'uninitialized',
    //     });
    // });

    // const options = {
    //     key:  fs.readFileSync(`${ ENV.CERT_LOCATION }/privkey.pem`, 'utf8'),
    //     cert: fs.readFileSync(`${ ENV.CERT_LOCATION }/fullchain.pem`, 'utf8')
    // };
    // const server = https.createServer(options, app);
    // server.listen(7777);
});
