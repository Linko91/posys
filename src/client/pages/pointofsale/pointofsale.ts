
import * as _ from 'lodash';

import { Component, EventEmitter, OnInit } from '@angular/core';

import { ModalController, AlertController, NavParams } from 'ionic-angular';

import { InvoiceService } from '../../services/invoice.service';
import { PromotionService } from '../../services/promotion.service';

import { CashPayComponent } from './cashpay/pointofsale.cashpay';
import { CurrencyFromSettingsPipe } from '../../pipes/currency-from-settings';

import { PromotionsManagerComponent } from '../promotions/management/promotions.management';

import { ApplicationSettingsService } from '../../services/settings.service';
import { StockItem } from '../../models/stockitem';
import { PromoItem } from '../../models/promoitem';
import { Promotion } from '../../models/promotion';
import { InvoicePromo } from '../../models/invoicepromo';
import { PurchaseMethod, Invoice } from '../../models/invoice';

const uuid = require('uuid/v4');

@Component({
  selector: 'my-page-pointofsale',
  templateUrl: 'pointofsale.html',
  providers: [CurrencyFromSettingsPipe]
})
export class PointOfSalePageComponent implements OnInit {

  public currentTransaction: StockItem[] = [];
  public currentPromotions: InvoicePromo[] = [];
  public temporaryPromotions: InvoicePromo[] = [];
  public searchItems: StockItem[] = [];
  public showSearchItems: boolean;
  public omniCancelControl = new EventEmitter();
  public isReturn: boolean;

  public prevTransaction: Invoice;

  public transactionItemButtons = [
    { text: 'Discount', callback: (item) => {

      let modal = this.modalCtrl.create(PromotionsManagerComponent, {
        promotion: new Promotion({
          name: `Discount: ${item.name}`,
          discountType: 'Percent',
          itemReductionType: 'All',
          discountGrouping: 'SKU',
          numItemsRequired: 1,
          discountValue: 0,
          startDate: this.settings.toIonicDateString(new Date()),
          endDate: this.settings.toIonicDateString(new Date()),
          temporary: true,
          promoItems: [
            new PromoItem(item)
          ]
        })
      }, { enableBackdropDismiss: false });

      modal.onDidDismiss(promo => {
        if(!promo) { return; }
        this.prService
          .createTemporary(promo, item)
          .toPromise()
          .then(invoicePromo => {
            this.temporaryPromotions.push(invoicePromo);
          });
      });

      modal.present();
    } },
    { text: 'Remove', callback: (item) => {
      const confirm = this.alertCtrl.create({
        title: `Remove "${item.name}"?`,
        message: 'This item will be removed from the current transaction.',
        buttons: [
          { text: 'Cancel' },
          {
            text: 'Confirm',
            handler: () => {
              this.currentTransaction = _.reject(this.currentTransaction, i => i === item);
              this.updatePromos();
            }
          }
        ]
      });
      confirm.present();
    } }
  ];

  public promotionItemButtons = [
    { text: 'Remove', callback: (item) => {
      const confirm = this.alertCtrl.create({
        title: `Remove "${item.realData.name}"?`,
        message: 'This promotion will be removed from the current transaction. ' +
          'If it is part of an existing promotion, just remove and re-add the item to get it back. ' +
          'Additionally, it may be re-added when adding new items, so make sure you do this last.',
        buttons: [
          { text: 'Cancel' },
          {
            text: 'Confirm',
            handler: () => {
              this.currentPromotions = _.reject(this.currentPromotions, i => i === item);
              this.temporaryPromotions = _.reject(this.temporaryPromotions, i => i === item);
            }
          }
        ]
      });
      confirm.present();
    } }
  ];

  constructor(public modalCtrl: ModalController,
              public alertCtrl: AlertController,
              public navParams: NavParams,
              public ivService: InvoiceService,
              public prService: PromotionService,
              public currencyFromSettings: CurrencyFromSettingsPipe,
              public settings: ApplicationSettingsService) {}

  ngOnInit() {
    this.prevTransaction = this.navParams.get('prevInvoice');
    this.isReturn = this.navParams.get('isReturn');
    if(this.prevTransaction) {
      let allReturnedItems = _.flattenDeep(_.map(this.prevTransaction.invoices, 'stockitems'));

      // get rid of all previously returned items so they can't be attempted to be returned again
      _.each(this.prevTransaction.stockitems, item => {
        const foundMatch = _.find(allReturnedItems, (checkItem: any) => {
          return checkItem.realData.sku === item.realData.sku && checkItem.quantity === item.quantity;
        });

        if(foundMatch) {
          allReturnedItems = _.reject(allReturnedItems, check => check === foundMatch);
          return;
        }
        this.addTransactionItem(item.realData);
      });
    }
  }

  itemPromos(item: StockItem): any[] {
    return _.filter(this.allPromotions, promo => {
      return promo.applyId === item.promoApplyId;
    });
  }

  addTransactionItem(item: StockItem): void {

    // clone so we can set the quantity to 1
    const newItem = _.cloneDeep(item);
    newItem.quantity = 1;
    newItem.promoApplyId = uuid();

    this.currentTransaction.push(newItem);

    this.updatePromos();

    // wait for next render cycle
    setTimeout(() => {
      const transactionList = document.getElementById('transaction-list');
      transactionList.scrollTop = transactionList.scrollHeight;
    });
  }

  addToTransaction($event): void {
    if(!$event) { return; }
    this.addTransactionItem($event);
    this.omniCancelControl.next();
  }

  updatePromos() {
    this.prService
      .checkFor(this.currentTransaction)
      .toPromise()
      .then(promotions => {
        this.currentPromotions = promotions;
      });
  }

  private clearTransaction() {
    this.currentTransaction = [];
    this.currentPromotions = [];
    this.prevTransaction = null;
    this.isReturn = false;
  }

  holdTransaction(): void {
    const confirm = this.alertCtrl.create({
      title: 'Hold Transaction?',
      message: 'You can resume this transaction later by going to invoices and finding this transaction.',
      buttons: [
        {
          text: 'Cancel'
        },
        {
          text: 'Confirm',
          handler: () => {
            this.createInvoice({
              purchaseMethod: 'Hold',
              purchasePrice: this.total,
              isOnHold: true
            });
          }
        }
      ]
    });
    confirm.present();
  }

  voidTransaction(): void {
    const confirm = this.alertCtrl.create({
      title: 'Void Transaction?',
      message: 'This is irreversible and unrecoverable. All items in the current transaction will be removed.',
      buttons: [
        {
          text: 'Cancel'
        },
        {
          text: 'Confirm',
          handler: () => {
            if(this.isReturn) {
              this.clearTransaction();
              return;
            }

            this.createInvoice({
              purchaseMethod: 'Void',
              purchasePrice: 0.00,
              isVoided: true
            });
          }
        }
      ]
    });
    confirm.present();
  }

  returnItems(): void {
    const confirm = this.alertCtrl.create({
      title: 'Return Items?',
      message: 'This will create an invoice with a negative value. All promotions will be removed from this transaction.',
      buttons: [
        {
          text: 'Cancel'
        },
        {
          text: 'Confirm',
          handler: () => {
            this.createInvoice({
              purchaseMethod: 'Return',
              purchasePrice: -this.total,
              isReturned: true,
              isVoided: true,
              promotions: this.allPromotions
            });
          }
        }
      ]
    });
    confirm.present();
  }

  setShowResults($event): void {
    this.showSearchItems = $event;
  }

  setSearchResults($event): void {
    // 1 result + force = scanner input (or, they hit enter)
    if($event.items.length === 1 && $event.force) {
      this.addTransactionItem($event.items[0]);
      return;
    }
  }

  getCashValue() {
    const modal = this.modalCtrl.create(CashPayComponent, {
      cashExpected: this.total
    }, { enableBackdropDismiss: false });
    modal.onDidDismiss((cashGiven) => {
      if(!cashGiven) { return; }
      this.finalize('Cash', cashGiven);
    });
    modal.present();
  }

  finalize(purchaseMethod: PurchaseMethod, cashGiven?: number) {
    const confirm = this.alertCtrl.create({
      title: 'Complete Transaction?',
      message: `You are doing a/n ${this.settings.invoiceMethodDisplay(purchaseMethod)} transaction with a value of 
                ${this.currencyFromSettings.transform(this.total)} across 
                ${this.currentTransaction.length} items with ${this.allPromotions.length} promotions.`,
      buttons: [
        {
          text: 'Cancel'
        },
        {
          text: 'Confirm',
          handler: () => {
            this.createInvoice({
              purchaseMethod,
              cashGiven,
              purchasePrice: this.total,
              promotions: this.allPromotions
            });
          }
        }
      ]
    });
    confirm.present();
  }

  createInvoice(opts) {
    opts.purchaseTime = new Date();
    opts.stockitems = this.currentTransaction;
    opts.taxCollected = this.tax;
    opts.subtotal = this.subtotal;
    const invoice = new Invoice(opts);

    if(this.prevTransaction) {
      invoice.invoiceReferenceId = this.prevTransaction.id;
    }

    const printReceipt = (printInvoice, printCustomer: boolean) => {
      this.ivService
        .print(printInvoice, printCustomer)
        .toPromise();
    };

    this.ivService
      .create(invoice)
      .toPromise()
      .then(newInvoice => {

        if(!newInvoice || !this.settings.canPrint || invoice.purchaseMethod === 'Void') {
          return;
        }

        const confirm = this.alertCtrl.create({
          title: 'Print Customer Receipt?',
          message: `Would you like to print a customer receipt?`,
          buttons: [
            {
              text: 'Cancel',
              handler: () => printReceipt(newInvoice, false)
            },
            {
              text: 'Confirm',
              handler: () => printReceipt(newInvoice, true)
            }
          ]
        });
        confirm.present();

        this.clearTransaction();
      });
  }

  get allPromotions() {
    return this.currentPromotions.concat(this.temporaryPromotions);
  }

  get promoDiscount() {
    return _.sumBy(this.allPromotions, 'cost');
  }

  get subtotal(): number {
    const transactionValue =  _.reduce(this.currentTransaction, (prev, cur) => prev + (cur.cost * cur.quantity), 0);
    return this.promoDiscount + transactionValue;
  }

  get subtotalTaxable(): number {
    let subtotal = 0;
    let promoClones = _.cloneDeep(this.allPromotions);

    const allItems = _.flatten(_.map(this.currentTransaction, item => {
      return _.map(new Array(item.quantity), () => _.cloneDeep(item));
    }));

    _.each(allItems, item => {
      if(!item.taxable) { return; }

      let itemValue = +item.cost;

      const applicablePromo = _.find(promoClones, promo => promo.applyId === item.promoApplyId);
      if(applicablePromo) {
        itemValue += applicablePromo.cost;
        promoClones = _.reject(promoClones, promo => promo === applicablePromo);
      }

      subtotal += itemValue;

    });

    return subtotal;
  }

  get tax(): number {
    return (this.settings.taxRate / 100) * this.subtotalTaxable;
  }

  get total(): number {
    return +((this.subtotal + this.tax).toFixed(2));
  }
}
