"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamiWalletApi = void 0;
const ERROR = {
    FAILED_PROTOCOL_PARAMETER: 'NO PROTOCOL PARAMS PASSED',
    TX_TOO_BIG: 'Transaction too big'
};
async function NamiWalletApi(NamiWalletObject, protocolParameterObject, serializationLib) {
    const S = serializationLib || await Promise.resolve().then(() => __importStar(require('@emurgo/cardano-serialization-lib-asmjs')));
    const Buffer = (await Promise.resolve().then(() => __importStar(require('buffer')))).Buffer;
    const Nami = NamiWalletObject;
    const protocolParameter = protocolParameterObject;
    const CoinSelection = (await Promise.resolve().then(() => __importStar(require('./coinSelection')))).default;
    async function isEnabled() {
        return await Nami.isEnabled();
    }
    async function enable() {
        if (!await isEnabled()) {
            try {
                await Nami.enable();
            }
            catch (error) {
                throw error;
            }
        }
    }
    async function getAddress() {
        return S.Address.from_bytes(Buffer.from(await getAddressHex(), 'hex')).to_bech32();
    }
    async function getAddressHex() {
        return await Nami.getChangeAddress();
    }
    async function getRewardAddress() {
        return S.RewardAddress.from_address(S.Address.from_bytes(Buffer.from(await getRewardAddressHex(), 'hex')))?.to_address().to_bech32();
    }
    async function getRewardAddressHex() {
        return await Nami.getRewardAddress();
    }
    async function getNetworkId() {
        let networkId = await Nami.getNetworkId();
        return {
            id: networkId,
            network: networkId == 1 ? 'mainnet' : 'testnet'
        };
    }
    async function getUtxos() {
        let Utxos = (await getUtxosHex()).map(u => S.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        let UTXOS = [];
        for (let utxo of Utxos) {
            let assets = _utxoToAssets(utxo);
            UTXOS.push({
                txHash: Buffer.from(utxo.input().transaction_id().to_bytes(), 'hex').toString('hex'),
                txId: utxo.input().index(),
                amount: assets
            });
        }
        return UTXOS;
    }
    async function getAssets() {
        let Utxos = await getUtxos();
        let AssetsRaw = [];
        Utxos.forEach(u => {
            AssetsRaw.push(...u.amount.filter(a => a.unit != 'lovelace'));
        });
        let AssetsMap = {};
        for (let k of AssetsRaw) {
            let quantity = parseInt(k.quantity);
            if (!AssetsMap[k.unit])
                AssetsMap[k.unit] = 0;
            AssetsMap[k.unit] += quantity;
        }
        return Object.keys(AssetsMap).map(k => ({ unit: k, quantity: AssetsMap[k].toString() }));
    }
    async function getUtxosHex() {
        return await Nami.getUtxos();
    }
    async function send({ address, amount = 0, assets = [], metadata = null, metadataLabel = '721' }) {
        let PaymentAddress = await getAddress();
        let utxos = (await getUtxosHex()).map(u => S.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        let lovelace = Math.floor(amount * 1000000).toString();
        let ReceiveAddress = address;
        let multiAsset = _makeMultiAsset(assets);
        let outputValue = S.Value.new(S.BigNum.from_str(lovelace));
        if (assets.length > 0)
            outputValue.set_multiasset(multiAsset);
        let minAda = S.min_ada_required(outputValue, S.BigNum.from_str(protocolParameter.minUtxo || "1000000"));
        if (S.BigNum.from_str(lovelace).compare(minAda) < 0)
            outputValue.set_coin(minAda);
        let outputs = S.TransactionOutputs.new();
        outputs.add(S.TransactionOutput.new(S.Address.from_bech32(ReceiveAddress), outputValue));
        let RawTransaction = _txBuilder({
            PaymentAddress: PaymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null
        });
        return await _signSubmitTx(RawTransaction);
    }
    async function sendMultiple({ recipients = [], metadata = null, metadataLabel = '721' }) {
        let PaymentAddress = await getAddress();
        let utxos = (await getUtxosHex()).map(u => S.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')));
        let outputs = S.TransactionOutputs.new();
        for (let recipient of recipients) {
            let lovelace = Math.floor((recipient.amount || 0) * 1000000).toString();
            let ReceiveAddress = recipient.address;
            let multiAsset = _makeMultiAsset(recipient.assets || []);
            let outputValue = S.Value.new(S.BigNum.from_str(lovelace));
            if ((recipient.assets || []).length > 0)
                outputValue.set_multiasset(multiAsset);
            let minAda = S.min_ada_required(outputValue, S.BigNum.from_str(protocolParameter.minUtxo || "1000000"));
            if (S.BigNum.from_str(lovelace).compare(minAda) < 0)
                outputValue.set_coin(minAda);
            outputs.add(S.TransactionOutput.new(S.Address.from_bech32(ReceiveAddress), outputValue));
        }
        let RawTransaction = _txBuilder({
            PaymentAddress: PaymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null
        });
        return await _signSubmitTx(RawTransaction);
    }
    // async function delegate({poolId, metadata = null, metadataLabel = '721'} : Delegate) : Promise<string>{
    //     let stakeKeyHash = S.RewardAddress.from_address(
    //         S.Address.from_bytes(
    //             Buffer.from(
    //                 await getRewardAddressHex(),
    //                 'hex'
    //             )
    //         )
    //     ).payment_cred().to_keyhash().to_bytes()
    //     let delegation = await getDelegation(await getRewardAddress())
    //     async function getDelegation(rewardAddr: string) : Promise<any>{
    //         let stake = await _blockfrostRequest(`/accounts/${rewardAddr}`)
    //         if(!stake || stake.error || !stake.pool_id) return {}
    //         return {
    //             active: stake.active,
    //             rewards: stake.withdrawable_amount,
    //             poolId: stake.pool_id,
    //         }
    //     }
    //     let pool = await _blockfrostRequest(`/pools/${poolId}`)
    //     let poolHex = pool.hex
    //     let utxos = (await getUtxosHex()).map(u => S.TransactionUnspentOutput.from_bytes(Buffer.from(u, 'hex')))
    //     let PaymentAddress = await getAddress()
    //     let outputs = S.TransactionOutputs.new()
    //     outputs.add(
    //         S.TransactionOutput.new(
    //           S.Address.from_bech32(PaymentAddress),
    //           S.Value.new(
    //               S.BigNum.from_str(protocolParameter.keyDeposit)
    //           )
    //         )
    //     )
    //     let transaction = _txBuilder({
    //         PaymentAddress,
    //         Utxos: utxos,
    //         ProtocolParameter: protocolParameter,
    //         Outputs: outputs,
    //         Delegation: {
    //             poolHex: poolHex,
    //             stakeKeyHash: stakeKeyHash,
    //             delegation: delegation
    //         },
    //         Metadata: metadata,
    //         MetadataLabel: metadataLabel
    //     })
    //     let txHash = await _signSubmitTx(transaction)
    //     return txHash
    // }
    async function signData(string) {
        let address = await getAddressHex();
        let coseSign1Hex = await Nami.signData(address, Buffer.from(string, "ascii").toString('hex'));
        return coseSign1Hex;
    }
    //////////////////////////////////////////////////
    //Auxiliary
    function AsciiToBuffer(string) {
        return Buffer.from(string, "ascii");
    }
    function HexToBuffer(string) {
        return Buffer.from(string, "hex");
    }
    function AsciiToHex(string) {
        return AsciiToBuffer(string).toString('hex');
    }
    function HexToAscii(string) {
        return HexToBuffer(string).toString("ascii");
    }
    function BufferToAscii(buffer) {
        return buffer.toString('ascii');
    }
    function BufferToHex(buffer) {
        return buffer.toString("hex");
    }
    //////////////////////////////////////////////////
    function _makeMultiAsset(assets) {
        let AssetsMap = {};
        for (let asset of assets) {
            let [policy, assetName] = asset.unit.split('.');
            let quantity = asset.quantity;
            if (!Array.isArray(AssetsMap[policy])) {
                AssetsMap[policy] = [];
            }
            AssetsMap[policy].push({
                "unit": Buffer.from(assetName, 'ascii').toString('hex'),
                "quantity": quantity
            });
        }
        let multiAsset = S.MultiAsset.new();
        for (const policy in AssetsMap) {
            const ScriptHash = S.ScriptHash.from_bytes(Buffer.from(policy, 'hex'));
            const Assets = S.Assets.new();
            const _assets = AssetsMap[policy];
            for (const asset of _assets) {
                const AssetName = S.AssetName.new(Buffer.from(asset.unit, 'hex'));
                const BigNum = S.BigNum.from_str(asset.quantity);
                Assets.insert(AssetName, BigNum);
            }
            multiAsset.insert(ScriptHash, Assets);
        }
        return multiAsset;
    }
    function _utxoToAssets(utxo) {
        let value = utxo.output().amount();
        const assets = [];
        assets.push({ unit: 'lovelace', quantity: value.coin().to_str() });
        if (value.multiasset()) {
            const multiAssets = value.multiasset().keys();
            for (let j = 0; j < multiAssets.len(); j++) {
                const policy = multiAssets.get(j);
                const policyAssets = value.multiasset().get(policy);
                const assetNames = policyAssets.keys();
                for (let k = 0; k < assetNames.len(); k++) {
                    const policyAsset = assetNames.get(k);
                    const quantity = policyAssets.get(policyAsset);
                    const asset = Buffer.from(policy.to_bytes()).toString('hex') + "." +
                        Buffer.from(policyAsset.name()).toString('ascii');
                    assets.push({
                        unit: asset,
                        quantity: quantity.to_str(),
                    });
                }
            }
        }
        return assets;
    }
    function _txBuilder({ PaymentAddress, Utxos, Outputs, ProtocolParameter, Metadata = null, MetadataLabel = '721', Delegation = null }) {
        const MULTIASSET_SIZE = 5000;
        const VALUE_SIZE = 5000;
        const totalAssets = 0;
        CoinSelection.setLoader(S);
        CoinSelection.setProtocolParameters(ProtocolParameter.minUtxo.toString(), ProtocolParameter.linearFee.minFeeA.toString(), ProtocolParameter.linearFee.minFeeB.toString(), ProtocolParameter.maxTxSize.toString());
        const selection = CoinSelection.randomImprove(Utxos, Outputs, 20 + totalAssets);
        const inputs = selection.input;
        const txBuilder = S.TransactionBuilder.new(S.LinearFee.new(S.BigNum.from_str(ProtocolParameter.linearFee.minFeeA), S.BigNum.from_str(ProtocolParameter.linearFee.minFeeB)), S.BigNum.from_str(ProtocolParameter.minUtxo.toString()), S.BigNum.from_str(ProtocolParameter.poolDeposit.toString()), S.BigNum.from_str(ProtocolParameter.keyDeposit.toString()), MULTIASSET_SIZE, MULTIASSET_SIZE);
        for (let i = 0; i < inputs.length; i++) {
            const utxo = inputs[i];
            txBuilder.add_input(utxo.output().address(), utxo.input(), utxo.output().amount());
        }
        if (Delegation) {
            let certificates = S.Certificates.new();
            if (!Delegation.delegation.active) {
                certificates.add(S.Certificate.new_stake_registration(S.StakeRegistration.new(S.StakeCredential.from_keyhash(S.Ed25519KeyHash.from_bytes(Buffer.from(Delegation.stakeKeyHash, 'hex'))))));
            }
            let poolKeyHash = Delegation.poolHex;
            certificates.add(S.Certificate.new_stake_delegation(S.StakeDelegation.new(S.StakeCredential.from_keyhash(S.Ed25519KeyHash.from_bytes(Buffer.from(Delegation.stakeKeyHash, 'hex'))), S.Ed25519KeyHash.from_bytes(Buffer.from(poolKeyHash, 'hex')))));
            txBuilder.set_certs(certificates);
        }
        let AUXILIARY_DATA;
        if (Metadata) {
            let METADATA = S.GeneralTransactionMetadata.new();
            METADATA.insert(S.BigNum.from_str(MetadataLabel), S.encode_json_str_to_metadatum(JSON.stringify(Metadata), 0));
            AUXILIARY_DATA = S.AuxiliaryData.new();
            AUXILIARY_DATA.set_metadata(METADATA);
            //const auxiliaryDataHash = S.hash_auxiliary_data(AUXILIARY_DATA)
            txBuilder.set_auxiliary_data(AUXILIARY_DATA);
        }
        for (let i = 0; i < Outputs.len(); i++) {
            txBuilder.add_output(Outputs.get(i));
        }
        const change = selection.change;
        const changeMultiAssets = change.multiasset();
        // check if change value is too big for single output
        if (changeMultiAssets && change.to_bytes().length * 2 > VALUE_SIZE) {
            const partialChange = S.Value.new(S.BigNum.from_str('0'));
            const partialMultiAssets = S.MultiAsset.new();
            const policies = changeMultiAssets.keys();
            const makeSplit = () => {
                for (let j = 0; j < changeMultiAssets.len(); j++) {
                    const policy = policies.get(j);
                    const policyAssets = changeMultiAssets.get(policy);
                    const assetNames = policyAssets.keys();
                    const assets = S.Assets.new();
                    for (let k = 0; k < assetNames.len(); k++) {
                        const policyAsset = assetNames.get(k);
                        const quantity = policyAssets.get(policyAsset);
                        assets.insert(policyAsset, quantity);
                        //check size
                        const checkMultiAssets = S.MultiAsset.from_bytes(partialMultiAssets.to_bytes());
                        checkMultiAssets.insert(policy, assets);
                        const checkValue = S.Value.new(S.BigNum.from_str('0'));
                        checkValue.set_multiasset(checkMultiAssets);
                        if (checkValue.to_bytes().length * 2 >=
                            VALUE_SIZE) {
                            partialMultiAssets.insert(policy, assets);
                            return;
                        }
                    }
                    partialMultiAssets.insert(policy, assets);
                }
            };
            makeSplit();
            partialChange.set_multiasset(partialMultiAssets);
            const minAda = S.min_ada_required(partialChange, S.BigNum.from_str(ProtocolParameter.minUtxo));
            partialChange.set_coin(minAda);
            txBuilder.add_output(S.TransactionOutput.new(S.Address.from_bech32(PaymentAddress), partialChange));
        }
        txBuilder.add_change_if_needed(S.Address.from_bech32(PaymentAddress));
        const transaction = S.Transaction.new(txBuilder.build(), S.TransactionWitnessSet.new(), AUXILIARY_DATA);
        const size = transaction.to_bytes().length * 2;
        if (size > ProtocolParameter.maxTxSize)
            throw ERROR.TX_TOO_BIG;
        return transaction.to_bytes();
    }
    async function _signSubmitTx(transactionRaw) {
        let transaction = S.Transaction.from_bytes(transactionRaw);
        const witneses = await Nami.signTx(Buffer.from(transaction.to_bytes()).toString('hex'));
        const signedTx = S.Transaction.new(transaction.body(), S.TransactionWitnessSet.from_bytes(Buffer.from(witneses, "hex")), transaction.auxiliary_data());
        const txhash = await Nami.submitTx(Buffer.from(signedTx.to_bytes()).toString('hex'));
        return txhash;
    }
    return {
        isEnabled,
        enable,
        getAddress,
        getAddressHex,
        getRewardAddress,
        getRewardAddressHex,
        getNetworkId,
        getUtxos,
        getAssets,
        getUtxosHex,
        send,
        sendMultiple,
        auxiliary: {
            Buffer: Buffer,
            AsciiToBuffer: AsciiToBuffer,
            HexToBuffer: HexToBuffer,
            AsciiToHex: AsciiToHex,
            HexToAscii: HexToAscii,
            BufferToAscii: BufferToAscii,
            BufferToHex: BufferToHex,
        }
    };
}
exports.NamiWalletApi = NamiWalletApi;
//# sourceMappingURL=index.js.map