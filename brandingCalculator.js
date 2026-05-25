var UnbrandedCount = 0;
var CurrentUnbrandedCount = 0;
var CheckoutRedirectUrl = "";
var CheckoutClicked = false;

var CartPage = (function ($) {
	var initialize = function () {
		CartPage.Events.Initialize();
		UnbrandedCount = 0;
		CurrentUnbrandedCount = 0;
		CheckoutRedirectUrl = "";
		CheckoutClicked = false;

		$(function () {
			$('[data-toggle="tooltip"]').tooltip();
		});
	};

	var functions = {
		CheckoutNowClick: function (redirectUrl) {
			CheckoutClicked = true;
			CheckoutRedirectUrl = redirectUrl;
			UnbrandedCount = $('.qtyInputDesktop').length;
			CurrentUnbrandedCount = 0;

			if (UnbrandedCount === 0) {
				CartPage.Functions.UpdateQtyCompleted(true);
			}
			else {
				$(".qtyInputDesktop").each(function (index) {
					CurrentUnbrandedCount++;
					var qtyElement = $(this);
					if (CartPage.Settings.ProcessingQty) {
						var interval = setInterval(function () {
							if (!CartPage.Settings.ProcessingQty) {
								clearInterval(interval);
								CartPage.Functions.QtyChange(qtyElement, redirectUrl);
							}
						}, 500);
					}
					else {
						CartPage.Functions.QtyChange(qtyElement, redirectUrl);
					}
				});
            }
		},

		UpdateQtyCompleted: function (qtyValidated) {
			if (CurrentUnbrandedCount === UnbrandedCount) {
				if (qtyValidated) {
					var cartTotalExcl = Number($("#cartTotalExcl").val());

					CartPage.Functions.StopProcessing($('.qtyInput'));

					if (cartTotalExcl < 500) {
						$(".moqWarningModal").modal('show');
					}
					else {
						window.location.href = CheckoutRedirectUrl;
					}
				}
				else {
					Utils.Notify({
						style: 'error',
						message: "Failed to validate cart item quantities. Some of the items in your cart might be out of stock and have been removed."
					});
				}
			}
        },

		IncrementQty: function (btn) {
			var input = $(btn).siblings('.qtyInput');
			var value = parseFloat(input.val()) + 1;

			input.val(value);
			input.attr('data-qty', value);

			var id = input.attr('id').split('-');

			if (id[1] === "desktopQtyInput") {
				$('#' + id[0] + 'mobileQtyInput').val(value);
				$('#' + id[0] + 'mobileQtyInput').attr('data-qty', value);
			}
			else {
				$('#' + id[0] + 'desktopQtyInput').val(value);
				$('#' + id[0] + 'desktopQtyInput').attr('data-qty', value);
			}

			CartPage.Functions.QtyChange(input);
		},

		DecrementQty: function (btn) {
			var input = $(btn).siblings('.qtyInput');
			var value = parseFloat(input.val()) - 1;
			if (value <= 0) value = 0;

			input.val(value);
			input.attr('data-qty', value);

			var id = input.attr('id').split('-');

			if (id[1] === "desktopQtyInput") {
				$('#' + id[0] + 'mobileQtyInput').val(value);
				$('#' + id[0] + 'mobileQtyInput').attr('data-qty', value);
			}
			else {
				$('#' + id[0] + 'desktopQtyInput').val(value);
				$('#' + id[0] + 'desktopQtyInput').attr('data-qty', value);
			}

			CartPage.Functions.QtyChange(input);
		},

		QtyChange: function (input, redirectUrl) {
			if (CartPage.Settings.ProcessingQty) {
				setTimeout(function ()
				{
					return QtyChange(input, redirectUrl);
				}, 500);
			}

			CartPage.Functions.StartProcessing(input);

			var qty = parseFloat($(input).val());

			if (qty > 0) {
				CartPage.Functions.UpdateQty(input);
			}
			else {
				CartPage.Functions.RemoveLine(input);
			}
        },

		UpdateQty: function (input) {
			var qtyValidated = false;

			var line = input.closest('tr[data-line-id], li[data-line-id]');

			// Get document line id
			var lineId = $(line).attr('data-line-id');

			//Get qty from input
			var qty = $(input).val();

			$.ajax({
				type: 'POST',
				url: '/checkout/cart/update-qty',
				cache: false,
				dataType: 'json',
				data: {
					documentLineId: lineId,
					qty: qty
				},
				beforeSend: function() {
					UI.Loader.Show({
						text: 'Updating'
					});
				},
				success: function (result) {
					if (result.HasIssues || !result.Success) {
						qtyValidated = false;

						var qtyNumber = parseFloat($(input).val());
						if (qtyNumber > result.Line.Product.Inventory.QtyOnHand) {
							$(input).val(result.Line.Product.Inventory.QtyOnHand);
							qty = result.Line.Product.Inventory.QtyOnHand;
							return CartPage.Functions.UpdateQty(input);
						}
						else {
							$(input).attr('data-qty', qty);
							$(input).attr('value', qty);
						}

						if (result.Warnings.length > 0) {
							var message = result.Warnings.length === 1 ? 'There was an issue updating the quantity: ' : 'There were issues updating the quantity: ';
							for (var i = 0; i < result.Warnings.length; i++) {
								if ((i - 1) == result.Warnings.length) {
									message += result.Warnings[i].Message;
								}
								else {
									message += result.Warnings[i].Message + ', ';
								}
							}

							Utils.Notify({
								style: 'error',
								message: message
							});
						}
                    }

					//Check if line exists and if on hand is 0
					if ($('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]').find('[data-total]') == null ||
						$('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]') == null ||
						result.Line == null ||
						result.Line.Product == null ||
						result.Line.Product.Inventory == null ||
						result.Line.Product.Inventory.QtyOnHand == null ||
						result.Line.Product.Inventory.QtyOnHand === 0)
					{
						// Remove the item from page
						$('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]').remove();
						$('tr[data-branding-id="' + lineId + '"]').remove();
						$('a[data-reveal-id="' + lineId + '"]').closest('tr.view-more').remove();
					}
					else
					{
						// Update the total
						$('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]').find('[data-total]').html(result.Line.SubTotalExcl);
						$('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]').find('[data-unitprice]').html(result.Line.UnitPriceExcl);
                    }

					// Refresh the Summary
					CartPage.Functions.ReloadOrderSummary();

					if (result.Success) {
						$(input).attr('data-qty', qty);
						$(input).val(qty);

						// Check for custom discount criteria
						$.get("/creativebrands/cart/discount-criteria").done(function (discountResult) {
							if (discountResult.Success) {

								if (discountResult.MaxDiscount) {
									$("#max-discount").show();
									$("#discount-container").hide();
								}
								else {
									$("#discount-container").show();
									$("#max-discount").hide();
									$("#possible-amount").html(discountResult.PossibleAmount);
									$("#discount-percentage").html(discountResult.DiscountPercentage);
								}
							}
						});
					}

					qtyValidated = result.Success;
				},
				error: function (error) {
					UI.Loader.Hide();
					console.error(error);
					CartPage.Functions.StopProcessing(input);

					Utils.Notify({
						style: 'error',
						message: "Something went wrong while updating your cart"
					});

					return;
				},
				complete: function () {
					UI.Loader.Hide();
					if (CheckoutClicked && CurrentUnbrandedCount === UnbrandedCount) {
						CartPage.Functions.UpdateQtyCompleted(qtyValidated);
						CheckoutClicked = false;
					}
					else {
						CartPage.Functions.StopProcessing(input);
					}
				}
			});
		},

		StartProcessing: function (input) {
			$("#checkoutBtn").attr("disabled", "disabled");
			$("#checkoutBtn").addClass("disabled");

			$(input).attr('disabled', 'disabled');

			CartPage.Settings.ProcessingQty = true;
		},

		StopProcessing: function (input) {
			$("#checkoutBtn").removeAttr("disabled");
			$("#checkoutBtn").removeClass("disabled");

			$(input).attr('disabled', false);

			CartPage.Settings.ProcessingQty = false;
		},

		ReloadPage: function () {
			window.location.reload();
		},

		ReloadOrderSummary: function (settings) {
			var eSettings = $.extend({

				beforeSend: function () {
					UI.Loader.Show({
						text: 'Loading'
					});
				},
				success: function (data) {
					$('.cart-summary-contain .cart-summary').remove();
					$('.cart-summary-contain').prepend(data);
				},
				error: function (error) {
					Utils.Notify({
						style: 'error',
						message: 'Issue updating the order summary. Please refresh your page.'
					});
					console.error(error);
				},
				complete: function () {
					UI.Loader.Hide();
				}

			}, settings);

			$.ajax({
				type: 'GET',
				url: '/creativebrands/checkout/summary',
				beforeSend: eSettings.beforeSend,
				cache: false,
				async: false,
				dataType: 'html',
				success: eSettings.success,
				error: eSettings.error,
				complete: eSettings.complete
			});
		},

		RemoveLine: function (target) {
			var lineId = target.closest('tr[data-line-id], li[data-line-id]').attr('data-line-id');
			$('.remove-item-modal').modal('show');

			$('[data-confirm-removal]').off('click').on('click', function () {
				$('.remove-item-modal').modal('hide');
				$.ajax({
					type: 'POST',
					url: '/checkout/cart/remove',
					cache: false,
					dataType: 'json',
					data: {
						documentLineId: lineId
					},
					beforeSend: function () {
						UI.Loader.Show({
							text: 'Removing'
						});
					},
					success: function (result) {
						if (result.HasIssues || result.NoItems)
							CartPage.Functions.ReloadPage();

						// Remove the item from page
						$('tr[data-line-id="' + lineId + '"], li[data-line-id="' + lineId + '"]').remove();
						$('tr[data-branding-id="' + lineId + '"]').remove();
						$('a[data-reveal-id="' + lineId + '"]').closest('tr.view-more').remove();

						// Enhanced Ecommerce - Remove item from cart
						const customEventRCI = document.createEvent("CustomEvent");
						customEventRCI.initCustomEvent('SF-EEC-RemoveCartItem', true, true, {
							detail: lineId
						});
						document.dispatchEvent(customEventRCI);
						
						// Refresh the Summary
						CartPage.Functions.ReloadOrderSummary();
					},
					error: function () { },
					complete: function () {
						UI.Loader.Hide();
						CartPage.Functions.StopProcessing(target);
					}
				});
			});
		}
	};

	var events = {
		Initialize: function () {
			CartPage.Events.Reveal();

			CartPage.Events.Notes();

			CartPage.Events.Remove();
		},

		Reveal: function() {
			$(document).on('click', 'table a.reveal', function () {
				var id = $(this).attr('data-reveal-id');
				$(this).closest('tr').toggleClass('full');
				$(this).closest('table').find('[data-line-id="' + id + '"]').find('.wrap').toggleClass('full');
				$(this).closest('table').find('[data-branding-id="' + id + '"]').toggleClass('hidden');
			}); 

			$(document).on('click', '.faux-table a.reveal', function() {
				$(this).closest('li').toggleClass('full');
			});
		},

		Notes: function() {
			$(document).on('click', '.view-notes', function() {
				$('.add-note-modal').modal('show');
			});
		},

		Remove: function() {
			$(document).on('click', '.remove-item', function() {
				CartPage.Functions.RemoveLine($(this));
			});
		}
	};

	var settings = {
		ProcessingQty: false
	};

	return {
		Initialize: initialize,
		Functions: functions,
		Events: events,
		Settings: settings
	};
})(jQuery);

$(function() {
	CartPage.Initialize();
});
//Filter Show
$(document).ready(function () {
    // Show Filters toggle
    $(document).on('click', '.show-filters .btn', function () {
        $('.product-filter-contain, .product-splash-sidemenu').toggleClass('visible');
    });

    $(document).on('click', '.product-filter-contain, .product-splash-sidemenu', function (e) {
        e.stopPropagation();
    });

    $(document).on('shown.bs.dropdown', '.dropdown', function () {
        $('.product-filter-contain, .product-splash-sidemenu').removeClass('visible');
    });

    $(document).click('*', function (event) {
        if ($(event.target).closest('.show-filters').length == 0) {
            $('.product-filter-contain, .product-splash-sidemenu').removeClass('visible');  
        }
    });

    $('.product-filter-contain, .product-splash-sidemenu').mCustomScrollbar();
});
var WishList = (function ($) {
	let WorkFlow = {
		Add: function (btn) {
			Button.Configure(btn, "Adding...", true, true);

			let productId = $(btn).attr('data-product-id');
			let productName = $(btn).attr('data-name');
			let productType = "Stock";

			if (productId === undefined) {
				Product.ValidateSegments($('[data-segment]'));
				Button.Reset(btn, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42.37 38.52" width="40px"> ' +
					'<path d="M41.87 11.66v-.43A10.91 10.91 0 0 0 31 .49a11.16 11.16 0 0 0-9.81 6.41A11.16 11.16 0 0 0 11.33.49 10.91 10.91 0 0 0 .49 11.23v.43S-.11 18.49 7.5 26a171.27 171.27 0 0 0 13.69 11.89A174.94 174.94 0 0 0 34.88 26c7.61-7.51 6.99-14.34 6.99-14.34Z" fill="none" stroke="#d9988b" stroke-miterlimit="10" stroke-width=".98" />' +
					'</svg >'
				);
				return;
			}

			sdk.wishlist.get({
				success: function (response) {
					var wishlistItems = response.data;
					if (wishlistItems != undefined) {
						$('#Wishlist').empty();
						$('#Wishlist').append('<option selected data-default="true" disabled="disabled">Select or add a new wishlist.</option>');

						for (var i = 0; i < wishlistItems.length; i++) {
							var wishlistItem = wishlistItems[i];
							$('#Wishlist').append('<option data-name="' + wishlistItem.Name + '" value="' + wishlistItem.DocumentId + '">' + wishlistItem.Name + '</option>');
						}
					}

					$('#add-wishlist-modal').attr('data-product-id', productId);
					$('#add-wishlist-modal').attr('data-name', productName);
					$('#add-wishlist-modal').attr('data-producttype', "Stock");
					$('#add-wishlist-modal').modal('show');

					Button.Reset(btn, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42.37 38.52" width="40px"> ' +
						'<path d="M41.87 11.66v-.43A10.91 10.91 0 0 0 31 .49a11.16 11.16 0 0 0-9.81 6.41A11.16 11.16 0 0 0 11.33.49 10.91 10.91 0 0 0 .49 11.23v.43S-.11 18.49 7.5 26a171.27 171.27 0 0 0 13.69 11.89A174.94 174.94 0 0 0 34.88 26c7.61-7.51 6.99-14.34 6.99-14.34Z" fill="none" stroke="#d9988b" stroke-miterlimit="10" stroke-width=".98" />' +
						'</svg >'
					);
				},
				error: function (resp) { console.log("Error Loading Wishlists:", resp) }
			});
		}
	},
		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		}
	return {
		WorkFlow: WorkFlow
	}
})(jQuery);
var Account = (function ($) {
	let Options = {
		FilterUrl: "",
		ProjectId: "",
		PaymentType: "",
		Client: null,
		Details: new Object,
		CreateDetails: new Object
	},
		Initialize = function (settings) {
			Options.FilterUrl = settings.FilterUrl;
			Options.ProjectId = settings.ProjectId;
			Options.PaymentType = settings.PaymentType;

			if (settings.Client !== undefined) {
				Options.Client = JSON.parse(settings.Client);
			}

			if (window.location.pathname === Options.FilterUrl.concat("/apollo/create")) {
				$("#matchAddress, label[for=matchAddress]").on("click", function () {
					if ($("#matchAddress").is(":checked")) {
						$("#add_delivery_address").slideDown();
					} else {
						$("#add_delivery_address").slideUp();
					}
				});
			}
		},

		WorkFlow = {
			Validate: function (btn, createAccount) {
				if (createAccount) {
					let form = $("#create-account-form");

					$.validator.addMethod("deliveryPhone", function (value, element) {
						return this.optional(element) || /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/.test(value);
					}, "Please enter a valid phone number without spaces.");

					$(form).validate({
						rules: {
							contactPerson: "required",
							billingAddress: {
								required: true,
								maxlength: 40
							},
							billingSuburb: {
								required: true,
								maxlength: 40
							},
							billingProvince: "required",
							billingPostalCode: "required",
							deliveryAddress: {
								required: true,
								maxlength: 40
							},
							deliverySuburb: {
								required: true,
								maxlength: 40
							},
							deliveryProvince: "required",
							deliveryPostalCode: "required",
							deliveryPhoneNo: {
								required: true,
								minlength: 10,
								deliveryPhone: true
							}
						},
						messages: {
							contactPerson: "Please enter your contact person",
							billingAddress: {
								required: "Please enter your billing address",
								maxlength: "Please enter no more than 40 characters"
							},
							billingSuburb: {
								required: "Please enter your suburb",
								maxlength: "Please enter no more than 40 characters"
							},
							billingProvince: "Please enter your province",
							billingPostalCode: "Please enter your postal code",
							deliveryAddress: {
								required: "Please enter your delivery address",
								maxlength: "Please enter no more than 40 characters"
							},
							deliverySuburb: {
								required: "Please enter your suburb",
								maxlength: "Please enter no more than 40 characters"
							},
							deliveryProvince: "Please enter your province",
							deliveryPostalCode: "Please enter your postal code",
							deliveryPhoneNo: "Please enter a valid phone number without spaces"
						}
					});

					let valid = $(form).valid();

					if (!valid) {
						Button.Reset(btn, "Create Client");
					}

					let matchAddress = $("#matchAddress").is(":checked");

					Options.CreateDetails.CompanyName = $(form).find('input[name="companyName"]').val();
					Options.CreateDetails.ContactPerson = $(form).find('input[name="contactPerson"]').val();
					Options.CreateDetails.BillingAddress = $(form).find('input[name="billingAddress"]').val();
					Options.CreateDetails.BillingSuburb = $(form).find('input[name="billingSuburb"]').val();
					Options.CreateDetails.BillingProvince = $(form).find('select[name="billingProvince"]').val();
					Options.CreateDetails.BillingPostalcode = $(form).find('input[name="billingPostalCode"]').val();
					Options.CreateDetails.DeliveryPhoneNo = $(form).find('input[name="deliveryPhoneNo"]').val();
					Options.CreateDetails.VatNumber = $(form).find('input[name="vatNumber"]').val();
					Options.CreateDetails.DeliveryAddress = matchAddress ? $(form).find('input[name="deliveryAddress"]').val() : $(form).find('input[name="billingAddress"]').val();
					Options.CreateDetails.DeliverySuburb = matchAddress ? $(form).find('input[name="deliverySuburb"]').val() : $(form).find('input[name="billingSuburb"]').val();
					Options.CreateDetails.DeliveryProvince = matchAddress ? $(form).find('select[name="deliveryProvince"]').val() : $(form).find('select[name="billingProvince"]').val();
					Options.CreateDetails.DeliveryPostalCode = matchAddress ? $(form).find('input[name="deliveryPostalCode"]').val() : $(form).find('input[name="billingPostalCode"]').val();
					Options.CreateDetails.ProjectId = Options.ProjectId;
					Options.CreateDetails.Email = Options.Client.ContactEmail;
					Options.CreateDetails.PaymentType = Options.PaymentType;
					Options.CreateDetails.ClientId = Options.Client.ClientId;

					return valid;
				}
				else {
					form = $("#edit-account-details-form");

					$.validator.addMethod("cnPhone", function (value, element) {
						return this.optional(element) || /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/.test(value);
					}, "Please enter a valid contact number.");

					$(form).validate({
						rules: {
							contactPerson: "required",
							contactEmail: {
								required: true,
								email: true
							},
							accountsEmail: {
								required: true,
								email: true
							},
							contactNumber: {
								required: true,
								minlength: 10,
								cnPhone: true
							},
							billingAddress: {
								required: true,
								maxlength: 40
							},
							billingSuburb: {
								required: true,
								maxlength: 40
							},
							billingProvince: "required",
							billingPostalCode: "required"
						},
						messages: {
							contactPerson: "Please enter your contact person",
							contactEmail: "Please enter a valid email address",
							accountsEmail: "Please enter a valid email address",
							contactNumber: "Please enter a valid contact number",
							billingAddress: {
								required: "Please enter your billing address",
								maxlength: "Please enter no more than 40 characters"
							},
							billingSuburb: {
								required: "Please enter your suburb",
								maxlength: "Please enter no more than 40 characters"
							},
							billingProvince: "Please select your province",
							billingPostalCode: "Please enter your postal code"
						}
					});

					valid = $(form).valid();

					if (!valid) {
						Button.Reset(btn, "Save");
					}

					Options.Details.CompanyName = $(form).find('input[name="companyName"]').val();
					Options.Details.ContactPerson = $(form).find('input[name="contactPerson"]').val();
					Options.Details.ContactEmail = $(form).find('input[name="contactEmail"]').val();
					Options.Details.AccountsEmail = $(form).find('input[name="accountsEmail"]').val();
					Options.Details.Telephone = $(form).find('input[name="contactNumber"]').val();
					Options.Details.BillingAddress = $(form).find('input[name="billingAddress"]').val();
					Options.Details.BillingSuburb = $(form).find('input[name="billingSuburb"]').val();
					Options.Details.BillingProvince = $(form).find('select[name="billingProvince"]').val();
					Options.Details.BillingPostalcode = $(form).find('input[name="billingPostalCode"]').val();
					Options.Details.ClientId = $(form).find('input[name="clientId"]').val();
					Options.Details.VatNumber = $(form).find('input[name="vatNumber"]').val();

					return valid;
				}
			},
			Create: function (btn) {
				Button.Configure(btn, "Creating...", true, true);

				let valid = WorkFlow.Validate(btn, true);

				if (valid) {
					$.post(Options.FilterUrl.concat("/create"), Options.CreateDetails).done(function (result) {
						Utils.Notify({
							style: result.success ? "success" : "error",
							message: result.message
						});

						Button.Reset(btn, "Create Client");
					});
				}
			},
			Edit: function (btn) {
				Button.Configure(btn, "Saving...", true, true);

				let valid = WorkFlow.Validate(btn, false);

				if (valid) {
					$.post(Options.FilterUrl.concat("/edit"), Options.Details).done(function (result) {
						Utils.Notify({
							style: result.success ? "success" : "error",
							message: result.message
						});

						Button.Reset(btn, "Save");
						$("#editAccountModal").modal("toggle");
						location.reload();
					});
				}
			},
			Delete: function () {
				bootbox.confirm({
					title: "Delete Account",
					message: "This is irreversible and if you continue, you will need to register a new account to resume using the store. Are you sure you want to delete your account?",
					buttons: {
						confirm: {
							label: 'Yes',
							className: 'btn-danger'
						},
						cancel: {
							label: 'No',
							className: 'btn-default'
						}
					},
					callback: function (result) {
						if (result) {
							Api.Execute('/ajax/profile/delete', 'DELETE', {
								resp200: function (data, status, request) {
									if (data.Success) {
										Utils.Notify({ message: "You will be redirected to the home page shortly.." })
										setTimeout(function () {
											window.location.href = "/";
										}, 2500);
									} else {
										Utils.Notify({ style: "error", message: data.ErrorMessage });
									}
								}
							});
						}
					}
				});
			}
		},

		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		}

	return {
		Initialize: Initialize,
		WorkFlow: WorkFlow
	}
})(jQuery);
var Artwork = (function ($) {
	let Options = {
		FilterUrl: "",
		DashboardUrl: ""
	},

		Initialize = {
			Main: function (settings) {
				Options.FilterUrl = settings.FilterUrl;
				Options.DashboardUrl = settings.DashboardUrl;

				if (window.location.pathname === Options.DashboardUrl) Initialize.Uploader();
			},
			Uploader: function (edit = false, artworkId = 0) {
				if (!edit) {
					$("body").on("change", "#uploadArtwork", function () {
						let input = this;
						if (input.files && input.files[0]) {
							let file = input.files[0];
							let fd = new FormData();
							fd.append("file", file);

							$.ajax({
								url: Options.FilterUrl.concat("/upload"),
								type: "post",
								data: fd,
								processData: false,
								contentType: false
							}).done(function (result) {
								if (!result.Success) {
									Utils.Notify({
										style: "error",
										message: result.Message
									});
								} else {
									window.location.href = Options.DashboardUrl;
								}
							});
						}
					});
				}
				else {
					$("body").on("change", "#editArtwork", function () {
						let input = this;
						if (input.files && input.files[0]) {
							let file = input.files[0];
							let fd = new FormData();
							fd.append("file", file);
							fd.append("artworkId", artworkId);

							$.ajax({
								url: Options.FilterUrl.concat("/upload"),
								type: "post",
								data: fd,
								processData: false,
								contentType: false
							}).done(function (result) {
								if (!result.Success) {
									Utils.Notify({
										style: "error",
										message: result.Message
									});
								} else {
									window.location.href = Options.DashboardUrl;
								}
							});
						}
					});
				}
			}
		},

		Load = function () {
			$.get(Options.FilterUrl, { oldArtworkId: $("#old-artwork-id").val(), selectArtwork: true }).done(function (result) {
				$("#artworkModal .modal-body").html(result);
				$("#editArtworkModal").modal("toggle");
				$("#artworkModal").modal("toggle");
			});
		},

		WorkFlow = {
			Edit: function (artworkId) {
				Initialize.Uploader(true, artworkId);
				$("#old-artwork-id").val(artworkId);
				$("#editArtworkModal").modal("toggle");
			},
			Delete: function (btn, artworkId) {
				Button.Configure(btn, "Deleting...", true, true);

				$.post(Options.FilterUrl.concat("/delete"), { artworkId: artworkId }).done(function (result) {
					if (!result.Success) {
						Utils.Notify({
							style: "error",
							message: result.Message
						});

						Button.Reset(btn, "Delete");
					} else {
						window.location.href = Options.DashboardUrl;
					}
				});
			},
			Select: function (oldArtworkId, artworkId) {
				$.post(Options.FilterUrl.concat("/select"), {
					oldArtworkId: oldArtworkId,
					newArtworkId: artworkId
				}).done(function (result) {
					if (!result.Success) {
						Utils.Notify({
							style: "error",
							message: result.Message
						});
					} else {
						window.location.href = Options.DashboardUrl;
					}
				});
			}
		},

		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		}

	return {
		Initialize: Initialize,
		Load: Load,
		WorkFlow: WorkFlow
	}
})(jQuery);
var BuyNow = (function ($) {
	let Options = {
		Type: "",
		Product: null,
		DocumentId: 0,
		EditMode: false,
		IQBranding: false,
		IQDetails: new Object,
		FilterUrl: "",
		LoaderUrl: "",
		ArtworkUrl: "",
		SelectedColours: null,
		SelectedSizes: [],
		SelectedQuantities: [],
		SelectedProducts: [],
		SelectedArtworks: [],
		SelectedPositions: [],
		SelectedNumberOfColours: [],
		SelectedVariants: [],
		ProductStock: {},
		GaConnector: new Object
	},

		Initialize = {
			GetSettings: function (productId) {
				$.get("/creativebrands/buynow/getsettings", { productId: productId }).done(
					function (settings) {
						Options.Type = settings.Type;
						if (settings.DocumentId > 0) Options.DocumentId = settings.DocumentId;

						Options.EditMode = settings.EditMode;
						Options.Product = settings.Product;
						Options.FilterUrl = settings.FilterUrl;
						Options.LoaderUrl = settings.LoaderUrl;
						Options.ArtworkUrl = settings.ArtworkUrl;

						if (!Options.Product.HasBranding) {
							$("#requestBrandingBtn").attr("disabled", "disabled");
						}

						WorkFlow.Events();
					});
			},
			Main: function (settings) {
				if (settings.Type.length > 0) Options.Type = settings.Type;
				if (settings.DocumentId > 0) Options.DocumentId = settings.DocumentId;

				Options.EditMode = settings.EditMode;
				Options.Product = JSON.parse(settings.Product);
				Options.FilterUrl = settings.FilterUrl;
				Options.LoaderUrl = settings.LoaderUrl;
				Options.ArtworkUrl = settings.ArtworkUrl;

				if (window.innerWidth <= 600) {
					$(window).scrollTop($('.masthead.header-b').outerHeight() - $('.top-bar').outerHeight());
				} else {
					$(window).scrollTop(0);
				}

				let type = "Branded";
				WorkFlow.Configure($(".workflow-next"), type, false);
			},
			Artwork: function (positionId) {
				$("#".concat(positionId)).change(function () {
					let input = this;
					let positionName = $(input).attr("data-position-name");

					if (input.files && input.files[0]) {
						let file = input.files[0];
						let fd = new FormData();
						fd.append("file", file);
						fd.append("artworkId", $("#position-artwork-id-".concat(positionId)).val());
						fd.append("documentId", Options.DocumentId);
						fd.append("positionId", positionId);
						fd.append("positionName", positionName);
						fd.append("sku", Options.Product.Sku);

						var extension = file.name.split('.').pop().toLowerCase();
						if (extension === "pdf" || extension === "psd" || extension === "ai" || extension === "eps" || extension === "epsf" || extension === "epsi" || extension === "svg") {
							$.ajax({
								url: Options.ArtworkUrl.concat("/upload"),
								type: "post",
								data: fd,
								processData: false,
								contentType: false,
								beforeSend: function () {
									$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", Options.LoaderUrl);
									$("#position-artwork-".concat(positionId)).hide();
								}
							}).done(function (result) {
								if (!result.Success) {
									Utils.Notify({
										style: "error",
										message: result.Message
									});
								} else {
									if (extension === "pdf") {
										$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", "/scss/themes/zeus/images/PDFLogo.png".concat("?v=", Math.floor(Math.random() * 10000)));
									}
									else if (extension === "psd") {
										$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", "/scss/themes/zeus/images/PhotoshopLogo.png".concat("?v=", Math.floor(Math.random() * 10000)));
									}
									else if (extension === "ai") {
										$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", "/scss/themes/zeus/images/IllistratorLogo.png".concat("?v=", Math.floor(Math.random() * 10000)));
									}
									else if (extension === "eps" || extension === "epsf" || extension === "epsi") {
										$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", "/scss/themes/zeus/images/EPSLogo.png".concat("?v=", Math.floor(Math.random() * 10000)));
									}
									else if (extension === "svg") {
										$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", result.Url.concat("?v=", Math.floor(Math.random() * 10000)));
									}

									//$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", result.Url.concat("?v=", Math.floor(Math.random() * 10000)));

									if (result.ArtworkId > 0) {
										$("#position-artwork-id-".concat(positionId)).val(result.ArtworkId);
										$("#position-artwork-".concat(positionId)).addClass("uploaded").show();
										$("#position-artwork-".concat(positionId)).parents('.brand-box').find('.position-title').addClass('progress-done ArtWorkUploaded');

										for (let i = 0; i < Options.SelectedArtworks.length; i++) {
											if (Options.SelectedArtworks[i].ArtworkId === result.ArtworkId &&
												Options.SelectedArtworks[i].PositionId === result.PositionId) {
												Options.SelectedArtworks.splice(i, 1);
											}
										}

										Options.SelectedArtworks.push({
											ArtworkId: result.ArtworkId,
											PositionId: result.PositionId
										});

										if ($('.ArtWorkUploaded').length === $('.position-options').length) {
											$(window).scrollTop($('#position-branding-actions').offset().top - window.outerHeight + $('header').outerHeight());
										}
									}

									$(input).val("");
								}
							});
						}
						else {
							Utils.Notify({
								style: "error",
								message: "Incorrect file type uploaded"
							});
						}
					}
				});
			},
			NumberOfColours: function (selectedNumberOfColours) {
				if (selectedNumberOfColours.length > 0) {
					$.each(selectedNumberOfColours, function (index, object) {
						Options.SelectedNumberOfColours.push({
							PositionId: object.PositionId,
							Number: object.Number
						});
					});
				}
			},
		},

		Load = {
			BrandedEnquiry: function (btn) {
				$.post(Options.FilterUrl.concat("/workflow/loadbrandedenquiry"), {
					url: "/branded-enquiry"
				}).done(function (result) {
					if (Options.Product.HasOnlyColour || Options.Product.HasNoSegmentation) {
						$("#qty-container").hide();
						$("#brandedEnquiry-container").html(result).show();
					} else {
						$("#size-container").hide();
						$("#brandedEnquiry-container").html(result).show();
					}

					$.post(Options.FilterUrl.concat("/prepbrandingenquiry"), {
						type: Options.Type,
						products: Options.SelectedProducts
					}).done(function (result) {
						$("#brandedEnquiry-container form").attr("id", "brandedEnquiryForm");

						$("#brandedEnquiry-container #name").val(result.FirstName);
						$("#brandedEnquiry-container #surname").val(result.LastName);
						$("#brandedEnquiry-container #email").val(result.Email);
						$("#brandedEnquiry-container #phone").val(result.PhoneNumber);

						var messageText = "Hi,\n\nI'm enquiring to brand the following product(s):\n\n";
						for (var i = 0; i < result.Products.length; i++) {
							var product = result.Products[i];
							messageText += "Product Name: " + product.Name + "\n";
							messageText += "Product Sku: " + product.Sku + "\n";
							messageText += "Product Quantity: " + product.Qty + "\n\n";
						}

						messageText += "Regards\n";
						messageText += result.FirstName + " " + result.LastName;

						$("#brandedEnquiry-container #message").css("height", "250px");
						$("#brandedEnquiry-container #message").val(messageText);
						$("#brandedEnquiry-container form button").attr("onclick", "$('#brandedEnquiryForm').submit();");

						WorkFlow.Events();
					});

					Button.Reset(btn, "Next");
					WorkFlow.Steps.Next();
				});
			},
			Positions: function (btn) {
				$.post(Options.FilterUrl.concat("/workflow/loadpositions"), {
					type: Options.Type,
					selectedProducts: Options.SelectedProducts,
					documentId: Options.DocumentId,
					sku: Options.Product.Sku,
					editMode: Options.EditMode
				}).done(function (result) {
					if (Options.Product.HasOnlyColour || Options.Product.HasNoSegmentation) {
						$("#qty-container").hide();
						$("#position-container").html(result).show();
					} else {
						$("#size-container").hide();
						$("#position-container").html(result).show();
					}
					Button.Reset(btn, "Next");
					WorkFlow.Steps.Next();
				});
			},
			PositionBrandings: function (btn) {
				Button.Configure(btn, "", true, true); // Proceed
				let valid = WorkFlow.Validate.Positions(btn);
				if (valid) {
					let selectedPositions = [];
					$("#position-section input:checked").filter(function () {
						return this.value;
					}).each(function () {
						let positionId = parseInt($(this).attr("data-position-id"));

						if (positionId > 0 && !isNaN(positionId)) {
							selectedPositions.push(positionId);
						}
					});

					$.post(Options.FilterUrl.concat("/workflow/loadpositionbrandings"), {
						type: Options.Type,
						selectedPositions: selectedPositions,
						selectedProducts: Options.SelectedProducts,
						documentId: Options.DocumentId,
						sku: Options.Product.Sku,
						editMode: Options.EditMode,
						hideArtwork: Options.IQBranding
					}).done(function (result) {
						$("#position-container").hide();
						$("#position-branding-container").html(result).show();
						UI.Select2($(".js-select"), { minimumResultsForSearch: Infinity });
						Button.Reset(btn, "Next");
						WorkFlow.Steps.Next();
					});
				}
			},
			NumberOfColours: function (element) {
				let typeId = $(element).find(":selected").attr("data-type-id");
				let positionId = $(element).attr("data-position-id");
				let brandBox = $("#position-dropdown-".concat(positionId)).parents('.brand-box');

				if (element.val() === "") {
					brandBox.find('.position-artwork').removeClass('in');
				}

				if (typeId !== undefined) {
					$.post(Options.FilterUrl.concat("/workflow/loadnumberofcolours"), {
						typeId: typeId,
						positionId: positionId,
						selectedProducts: Options.SelectedProducts,
						selectedNumberOfColours: Options.SelectedNumberOfColours
					}).done(function (result) {
						brandBox.find("#number-of-colours-container").html(result);

						// show and hide logic for artwork field
						if (brandBox.find('.number-of-colours').length === 0) {
							brandBox.find('.position-artwork').addClass('in');
							if (Options.Type === "InstantQuote") {
								brandBox.find(".position-title").addClass('progress-done');
							}

							setTimeout(function () {
								if ($('.progress-done').length === $('.position-options').length) {
									$(window).scrollTop($('#position-branding-actions').offset().top - window.outerHeight + $('header').outerHeight());
								}
							}, 200);
						} else {

							if (parseInt(brandBox.find('.number-of-colours').val()) > 0) {
								brandBox.find('.position-artwork').addClass('in');
								brandBox.find(".position-title").addClass('progress-done');
							} else {
								brandBox.find('.position-artwork').removeClass('in');
							}

							brandBox.find('.number-of-colours').change(function () {
								brandBox.find('.position-artwork').addClass('in');
								if (Options.Type === "InstantQuote") {
									brandBox.find(".position-title").addClass('progress-done');
								}

								if ($(this).val() === "0" || $(this).val() === 0) {
									brandBox.find(".position-title").removeClass('progress-done');
								} else if (brandBox.find(".position-title").hasClass('ArtWorkUploaded')) {
									brandBox.find(".position-title").addClass('progress-done');
								}

								if (Options.IQBranding) {
									setTimeout(function () {
										if ($('.progress-done').length === $('.position-options').length) {
											$(window).scrollTop($('#position-branding-actions').offset().top - window.outerHeight + $('header').outerHeight());
										}
									}, 200);
								}
							});
						}

						if (Options.Type !== "InstantQuote") {
							brandBox.find(".position-title").addClass('progress-started');
						}

						UI.Select2($(".js-select"), { minimumResultsForSearch: Infinity });
					});
				} else {
					$("#position-dropdown-".concat(positionId)).parents('.position-branding').find("#number-of-colours-container").attr("data-no-number-of-colours", true).html("");
					brandBox.find('.position-artwork').addClass('in');
				}
			},
			Artwork: function (e, element) {
				e.preventDefault();
				$("#artworkModal .modal-body").html("");
				let positionId = $(element).attr("data-position-id");
				let oldArtworkId = $("#position-artwork-id-".concat(positionId)).val();

				$.get(Options.FilterUrl.concat("/artwork/loadartwork"), {
					positionId: positionId,
					oldArtworkId: oldArtworkId
				}).done(function (result) {
					$("#artworkModal .modal-body").html(result);
					$("#artworkModal").modal("toggle");
				});
			},
			InstantQuote: function (btn) {
				if (Options.IQBranding) {
					let positionBrandingsValid = WorkFlow.Validate.PositionBrandings(btn);
					let numberOfColoursValid = WorkFlow.Validate.NumberOfColours(btn);

					if (positionBrandingsValid && numberOfColoursValid) {
						$.get(Options.FilterUrl.concat("/workflow/loadinstantquote")).done(function (result) {
							$("#position-branding-container").hide();
							$("#instant-quote-container").html(result).show();
							Button.Reset(btn, "Next");
							WorkFlow.Steps.Next();
						});
					}
				} else {
					$.get(Options.FilterUrl.concat("/workflow/loadinstantquote")).done(function (result) {
						if (Options.Product.HasNoSegmentation || Options.Product.HasOnlyColour) {
							$("#qty-container").hide();
						} else {
							$("#size-container").hide();
						}

						$("#instant-quote-container").html(result).show();
						Button.Reset(btn, "Next");
						WorkFlow.Steps.Next();
					});
				}
			},
			BrandingLayout: function () {
				$('#branding-img-modal').modal('toggle');
			}
		},

		WorkFlow = {
			Validate: {
				BuildProducts: function (save) {
					Options.SelectedProducts = [];

					var hasColors = $(".product-colour a").length > 0;
					var hasSizes = $(".product-size a").length > 0;
					var sku = $("#masterProductId").attr("data-product-sku");

					var productId = 0;
					var maxOrder = 0;
					var minOrder = 0;
					var onHand = 0;

					if (!hasColors && !hasSizes) {
						var masterProductId = parseInt($("#masterProductId").val());
						var masterSku = $("#masterProductId").attr("data-product-sku");

						maxOrder = isNaN(parseInt($("#masterProductId").attr("data-max-order"))) ? 0 : parseInt($("#masterProductId").attr("data-max-order"));
						minOrder = isNaN(parseInt($("#masterProductId").attr("data-min-order"))) ? 0 : parseInt($("#masterProductId").attr("data-min-order"));
						onHand = isNaN(parseInt($("#masterProductId").attr("data-stock"))) ? 0 : parseInt($("#masterProductId").attr("data-stock"));

						if (onHand < maxOrder || maxOrder == 0) {
							maxOrder = onHand;
						}

						var qty = parseInt($("#productQty").val());

						if (qty > maxOrder) {
							$("#productQty").val(qty);
							qty = maxOrder;
							Utils.Notify({
								style: "warning",
								message: "Your quantity for " + masterSku + " is more than the available stock and has been set to the maximum quantity amount."
							});
						}

						if (minOrder > qty) {
							Utils.Notify({
								style: "warning",
								message: "The minimum order quantity for " + masterSku + " is " + minOrder + "."
							});
							return false;
						}

						if (masterProductId != 0) {
							if (Options.SelectedProducts.indexOf(masterProductId) < 0) {
								Options.SelectedProducts.push({
									ProductId: masterProductId,
									Qty: qty
								});
							}
							else {
								var item = Options.SelectedProducts.find(x => x.ProductId === masterProductId);
								item.Qty += qty;
							}
						}
					}

					//Sku builder for color
					if (hasColors) {
						var color = $(".product-colour a.active").data("color");
						var colorName = $(".product-colour").data("segment-title");

						//Validate color selected
						if (color == undefined) {
							Utils.Notify({
								style: "warning",
								message: "Please select a " + colorName + " before adding to cart"
							});
							return false;
						}
						else {
							sku += "-" + color;
						}

						if (!hasSizes) {
							var input = $('.product-colour input[data-product-sku="' + sku + '"]');

							if (input.length !== 0) {

								maxOrder = isNaN(parseInt($(input).first().attr("data-max-order"))) ? 0 : parseInt($(input).first().attr("data-max-order"));
								minOrder = isNaN(parseInt($(input).first().attr("data-min-order"))) ? 0 : parseInt($(input).first().attr("data-min-order"));
								onHand = isNaN(parseInt($(input).first().attr("data-stock"))) ? 0 : parseInt($(input).first().attr("data-stock"));

								if (onHand < maxOrder || maxOrder == 0) {
									maxOrder = onHand;
								}

								var qty = parseInt($("#productQty").val());

								if (qty > maxOrder) {
									$("#productQty").val(qty);
									qty = maxOrder;

									Utils.Notify({
										style: "warning",
										message: "Your quantity for " + color + " is more than the available stock and has been set to the maximum quantity amount."
									});
								}

								if (minOrder > qty) {
									Utils.Notify({
										style: "warning",
										message: "The minimum order quantity for " + color + " is " + minOrder + "."
									});
									return false;
								}

								productId = parseInt((input).first().attr("data-productid"));

								if (productId != 0) {
									if (Options.SelectedProducts.indexOf(productId) < 0) {
										Options.SelectedProducts.push({
											ProductId: productId,
											Qty: qty
										});
									}
									else {
										var item = Options.SelectedProducts.find(x => x.ProductId === productId);
										item.Qty += qty;
									}
								}
							}
						}
					}

					//Sku builder for size
					if (hasSizes) {
						var sizes = $(".product-size a.active");
						var sizeName = $(".product-size").data("segment-title");

						//Validate size selected
						if (sizes == undefined || sizes.length == 0) {
							Utils.Notify({
								style: "warning",
								message: "Please select a " + sizeName + " before adding to cart"
							});
							return false;
						}
						else {
							for (var i = 0; i < sizes.length; i++) {
								let colorSku = sku;
								colorSku += "-" + $(sizes[i]).data("size");

								var size = $(sizes[i]).data("size");
								var sizeQty = parseInt($(sizes[i]).parent().find('input[data-size="' + size + '"][type="number"]').val());

								var input = $('.product-size input[data-product-sku="' + colorSku + '"]');
								if (input.length !== 0) {
									maxOrder = isNaN(parseInt($(input).first().attr("data-max-order"))) ? 0 : parseInt($(input).first().attr("data-max-order"));
									minOrder = isNaN(parseInt($(input).first().attr("data-min-order"))) ? 0 : parseInt($(input).first().attr("data-min-order"));
									onHand = parseInt($(input).first().attr("data-stock"));

									if (onHand < maxOrder || maxOrder == 0) {
										maxOrder = onHand;
									}

									if (sizeQty > maxOrder) {
										$(sizes[i]).parent().find('input[data-size="' + size + '"][type="number"]').val(maxOrder);
										sizeQty = maxOrder;

										Utils.Notify({
											style: "warning",
											message: "Your quantity for " + size + " is more than the available stock and has been set to the maximum quantity amount."
										});
									}

									productId = parseInt($(input).first().attr("data-productid"));

									if (productId != 0) {
										if (Options.SelectedProducts.indexOf(productId) < 0) {
											Options.SelectedProducts.push({
												ProductId: productId,
												Qty: sizeQty
											});
										}
										else {
											var item = Options.SelectedProducts.find(x => x.ProductId === productId);
											item.Qty += sizeQty;
										}
									}
								}
							}
						}
					}

					//Segment search
					if (Options.SelectedProducts.length == 0) {
						if (hasColors && hasSizes) {
							var color = $(".product-colour a.active").data("color");
							var colors = $('.product-colour input.color_' + color);

							var activeSizes = $(".product-size a.active");
							for (var k = 0; k < activeSizes.length; k++) {
								var size = $(activeSizes[k]).data("size");
								var sizes = $('.product-size input.size_' + size);

								var sizeQty = parseInt($(activeSizes[k]).parent().find('input[data-size="' + size + '"][type="number"]').val());

								for (var i = 0; i < colors.length; i++) {
									var colorVariantId = $(colors[i]).attr("data-productid");

									for (var j = 0; j < sizes.length; j++) {
										var sizeVariantId = $(sizes[j]).attr("data-productid");

										var minVariantOrder = parseInt($(sizes[j]).attr("data-min-order"));
										var maxVariantOrder = parseInt($(sizes[j]).attr("data-max-order"));
										var onHandVariantOrder = parseInt($(sizes[j]).attr("data-stock"));

										if (colorVariantId == sizeVariantId) {
											found = true;
											maxOrder = maxVariantOrder;
											minOrder = minVariantOrder;
											onHand = onHandVariantOrder;

											if (onHand < maxOrder) {
												maxOrder = onHand;
											}

											productId = parseInt(sizeVariantId);

											if (sizeQty > maxOrder) {
												$(sizes[i]).parent().find('input[data-size="' + size + '"][type="number"]').val(maxOrder);
												sizeQty = maxOrder;

												Utils.Notify({
													style: "warning",
													message: "Your quantity for " + size + " is more than the available stock and has been set to the maximum quantity amount."
												});
											}

											if (productId != 0) {
												if (Options.SelectedProducts.indexOf(productId) < 0) {
													Options.SelectedProducts.push({
														ProductId: productId,
														Qty: sizeQty
													});
												}
												else {
													var item = Options.SelectedProducts.find(x => x.ProductId === productId);
													item.Qty += sizeQty;
												}
											}

											break;
										}
									}
								}
							}
						}
						else if (hasColors) {
							var color = $(".product-colour a.active").data("color");
							var colors = $('.product-colour input.color_' + color);
							var qty = parseInt($("#productQty").val());

							minOrder = parseInt($(colors[0]).attr("data-min-order"));
							maxOrder = parseInt($(colors[0]).attr("data-max-order"));
							onHand = parseInt($(colors[0]).attr("data-stock"));

							if (onHand < maxOrder || maxOrder == 0) {
								maxOrder = onHand;
							}

							if (qty > maxOrder) {
								$("#productQty").val(qty);
								qty = maxOrder;

								Utils.Notify({
									style: "warning",
									message: "Your quantity for " + color + " is more than the available stock and has been set to the maximum quantity amount."
								});
							}

							productId = parseInt((colors[0]).attr("data-productid"));

							if (productId > 0) {
								if (Options.SelectedProducts.indexOf(productId) < 0) {
									Options.SelectedProducts.push({
										ProductId: productId,
										Qty: qty
									});
								}
								else {
									var item = Options.SelectedProducts.find(x => x.ProductId === productId);
									item.Qty += qty;
								}
							}
						}
						else if (hasSizes) {
							var activeSizes = $(".product-size a.active");
							for (var i = 0; i < activeSizes.length; i++) {
								var size = $(activeSizes[i]).data("size");
								var sizes = $('.product-colour input.size_' + size);
								var sizeQty = parseInt($(sizes[i]).parent().find('input[data-size="' + size + '"][type="number"]').val());

								minOrder = parseInt($(sizes[0]).attr("data-min-order"));
								maxOrder = parseInt($(sizes[0]).attr("data-max-order"));
								onHand = parseInt($(sizes[0]).attr("data-stock"));

								if (onHand < maxOrder || maxOrder == 0) {
									maxOrder = onHand;
								}

								if (sizeQty > maxOrder) {
									$(sizes[i]).parent().find('input[data-size="' + size + '"][type="number"]').val(maxOrder);
									sizeQty = maxOrder;

									Utils.Notify({
										style: "warning",
										message: "Your quantity for " + size + " is more than the available stock and has been set to the maximum quantity amount."
									});
								}

								productId = parseInt((sizes[0]).attr("data-productid"));

								if (productId != 0) {
									if (Options.SelectedProducts.indexOf(productId) < 0) {
										Options.SelectedProducts.push({
											ProductId: productId,
											Qty: sizeQty
										});
									}
									else {
										var item = Options.SelectedProducts.find(x => x.ProductId === productId);
										item.Qty += sizeQty;
									}
								}
							}
						}
						else {
							console.error("Unable to find variant (Segment search)");
							Utils.Notify({
								style: "error",
								message: "Unable to find product"
							});
						}
					}

					//Check SelectedProducts
					for (var x = 0; x < Options.SelectedProducts.length; x++) {
						if (Options.SelectedProducts[x].ProductId == 0 || Options.SelectedProducts[x].Qty == 0 || Options.SelectedProducts[x].Qty == NaN) {
							Utils.Notify({
								style: "error",
								message: "Something went wrong validating your selected products"
							});

							return false;
							break;
						}
					}

					//Request Branding redirect
					if (save) {
						var productIds = "";
						var qtys = "";

						for (var i = 0; i < Options.SelectedProducts.length; i++) {
							if (productIds == "") {
								productIds += Options.SelectedProducts[i].ProductId;
								qtys += Options.SelectedProducts[i].Qty;
							}
							else {
								productIds += "," + Options.SelectedProducts[i].ProductId;
								qtys += "," + Options.SelectedProducts[i].Qty;
							}
						}
						window.localStorage.setItem("SavedProductIds", productIds);
						window.localStorage.setItem("SavedProductQtys", qtys);
					}

					//Return true and bulk add to cart
					return true;
				},
				GetOnhand: function (selectedColor, selectedSize) {
					Options.ProductStock = {};

					var hasColors = $(".product-colour a").length > 0;
					var hasSizes = $(".product-size a").length > 0;
					var maxOrder = 0;
					var minOrder = 0;
					var onHand = 0;

					if (!hasColors && !hasSizes) {
						var masterSku = $("#masterProductId").attr("data-product-sku");
						maxOrder = parseInt($("#masterProductId").attr("data-min-order"));
						minOrder = parseInt($("#masterProductId").attr("data-max-order"));
						onHand = parseInt($("#masterProductId").attr("data-stock"));

						Options.ProductStock = {
							Color: null,
							Size: null,
							Sku: masterSku,
							OnHand: onHand,
							MaxOrder: maxOrder,
							MinOrder: minOrder
						};
					}
					else if (hasColors && hasSizes && selectedColor != null && selectedColor != "" && selectedSize != null && selectedSize != "") {
						var colorInputs = $('.product-colour input.color_' + selectedColor);

						for (var i = 0; i < colorInputs.length; i++) {
							var colorInputSku = $(colorInputs[i]).attr("data-product-sku");
							var color = $(colorInputs[i]).attr("data-color");
							var sizeInput = $('.product-size input[data-product-sku="' + colorInputSku + '"]');

							var size = $(sizeInput).attr("data-size");

							if (size == selectedSize) {
								maxOrder = parseInt($(sizeInput).attr("data-max-order"));
								minOrder = parseInt($(sizeInput).attr("data-min-order"));
								onHand = parseInt($(sizeInput).attr("data-stock"));

								Options.ProductStock = {
									Color: color,
									Size: size,
									Sku: colorInputSku,
									OnHand: onHand,
									MaxOrder: maxOrder,
									MinOrder: minOrder
								};

								break;
							}
						}
					}
					else if (hasColors && selectedColor != null && selectedColor != "") {
						var colors = $('.product-colour input.color_' + selectedColor);

						minOrder = parseInt($(colors[0]).attr("data-min-order"));
						maxOrder = parseInt($(colors[0]).attr("data-max-order"));
						onHand = parseInt($(colors[0]).attr("data-stock"));

						var colorSku = $(colors[0]).attr("data-product-sku");

						Options.ProductStock = {
							Color: selectedColor,
							Size: null,
							Sku: colorSku,
							OnHand: onHand,
							MaxOrder: maxOrder,
							MinOrder: minOrder,
						};
					}
					else if (hasSizes && selectedSize != null && selectedSize != "") {
						var activeSizes = $(".product-size a");
						for (var i = 0; i < activeSizes.length; i++) {
							var size = $(activeSizes[i]).data("size");
							var sizes = $('.product-colour input.size_' + size);

							if (size == selectedSize) {
								minOrder = parseInt($(sizes[0]).attr("data-min-order"));
								maxOrder = parseInt($(sizes[0]).attr("data-max-order"));
								onHand = parseInt($(sizes[0]).attr("data-stock"));

								var sizeSku = $(sizes[0]).attr("data-product-sku");

								Options.ProductStock = {
									Color: null,
									Size: size,
									Sku: sizeSku,
									OnHand: onHand,
									MaxOrder: maxOrder,
									MinOrder: minOrder,
								};

								break;
							}
						}
					}
					else {
						return null;
					}

					return Options.ProductStock;
				},
				Artworks: function (btn) {
					let valid = true;
					if (!Options.IQBranding) {
						$(".position-options").each(function () {
							let artworkId = $(this).find("[data-position-artwork-id]").val();

							if (artworkId <= 0 || artworkId === "" || artworkId === undefined) {
								Utils.Notify({
									style: "warning",
									message: "Please upload artwork(s) for all selected position(s)."
								});
								valid = false;
								Button.Reset(btn, "Next");
							}
						});
					}

					return valid;
				},
				Positions: function (btn) {
					let valid = true;

					let selectedPositions = [];
					$("#position-section input[name='position-select']:checked").filter(function () {
						return this.value;
					}).each(function () {
						let positionId = parseInt($(this).attr("data-position-id"));

						if (positionId > 0 && !isNaN(positionId)) {
							selectedPositions.push(positionId);
						}
					});

					if (selectedPositions.length <= 0) {
						Utils.Notify({
							style: "warning",
							message: "Please select position(s)."
						});
						valid = false;
						Button.Reset(btn, "Next");
					}

					return valid;
				},
				PositionBrandings: function (btn) {
					Options.SelectedPositions = [];

					let valid = true;
					$(".position-options").each(function () {
						let branding = $(this).find("[data-position-id] option:selected").val();

						if (branding === "" || branding === undefined || branding === "0") {
							Utils.Notify({
								style: "warning",
								message: "Please select branding(s) for all selected position(s)."
							});
							valid = false;
							Button.Reset(btn, "Next");
						}
					});

					$("[data-position-id] option:selected").filter(function () {
						return this.value !== "";
					}).each(function () {
						Options.SelectedPositions.push({
							PositionId: $(this).attr("data-position-id"),
							TypeId: $(this).attr("data-type-id"),
							Name: $(this).attr("data-name"),
							Description: $(this).attr("data-description"),
							PositionOrder: $(this).attr("data-position-order"),
							PositionDescription: $(this).attr("data-position-description")
						});
					});

					return valid;
				},
				NumberOfColours: function (btn) {
					Options.SelectedNumberOfColours = [];

					let valid = true;

					if ($(".number-of-colours").length <= 0 &&
						$("[data-position-id] option:selected").filter(function () {
							return this.value !== "";
						}).length > 0) {
						$("[data-position-id] option:selected").filter(function () {
							return this.value !== "";
						}).each(function () {
							Options.SelectedNumberOfColours.push({
								PositionId: $(this).attr("data-position-id"),
								Number: 0
							});
						});
					} else {
						$(".position-options").each(function () {
							let numberOfColour = $(this).find("[data-number-of-colours-position-id] option:selected").val();
							let hasNoNumberOfColours = $(this).find(".number-of-colours-container").attr("data-no-number-of-colours") === "true";

							if (!hasNoNumberOfColours) {
								if (numberOfColour <= 0 || numberOfColour === "" || numberOfColour === undefined) {
									Utils.Notify({
										style: "warning",
										message: "Please select number of colour(s) for all selected branding(s)."
									});
									valid = false;
									Button.Reset(btn, "Next");
								}
							}
						});

						$(".number-of-colours option:selected").filter(function () {
							return this.value > 0;
						}).each(function () {
							Options.SelectedNumberOfColours.push({
								PositionId: $(this).closest(".number-of-colours").attr("data-number-of-colours-position-id"),
								Number: $(this).val()
							});
						});
					}

					return valid;
				},
				InstantQuote: function (btn) {
					let form = $("#instant-quote-form");

					$.validator.addMethod("properEmail", function (value, element) {
						let regex = /^([a-zA-Z0-9_.+-])+\@(([a-zA-Z0-9-])+\.)+([a-zA-Z0-9]{2,4})+$/;
						return this.optional(element) || regex.test(value);
					}, "Please enter a valid email address.");

					$.validator.addMethod("oqPhone", function (value, element) {
						return this.optional(element) || /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/.test(value);
					}, "Please enter a valid phone number.");

					$(form).validate({
						rules: {
							Name: "required",
							Email: {
								required: true,
								email: { properEmail: true },
								properEmail: true
							},
							Phone: {
								required: true,
								minlength: 10,
								oqPhone: true
							},
							ConfirmEmail: {
								equalTo: "#Email"
							}
						},
						messages: {
							Name: "Please enter your firstname",
							Email: "Please enter a valid email address",
							Phone: "Please enter a valid phone number",
							ConfirmEmail: "Please make sure the emails match"
						}
					});

					let valid = $(form).valid();

					if (!valid) {
						Button.Reset(btn, "Get Quote");
					}

					Options.IQDetails.Name = $(form).find('input[name="Name"]').val();
					Options.IQDetails.Phone = $(form).find('input[name="Phone"]').val();
					Options.IQDetails.Email = $(form).find('input[name="Email"]').val();
					Options.IQDetails.Company = $(form).find('input[name="CompanyName"]').val();

					return valid;
				},
				Order: {
					Check: function (element) {
						if (Options.Type !== "InstantQuote") {
							let value = parseInt($(element).val());
							let min = parseInt($(element).attr("min"));
							let max = parseInt($(element).attr("max"));
							let stockQty = parseInt($(element).attr("data-stock-qty"));

							if (value < min) {
								$(element).val(min);
							} else if (max !== "NaN") {
								if (value > max) {
									$(element).val(max);
								}
							}

							if (value > stockQty) {
								$(element).val(stockQty).popover({
									html: true,
									placement: "top",
									animation: true,
									content: function () {
										return "<div class='text-center'>Only ".concat($(element).val(), " available</div>");
									}
								});

								$(element).popover("show");
								setTimeout(function () {
									$('.popover').popover('destroy');
								}, 2000);
							}

							if (parseInt($(element).val()) > 0) {
								$(element).parent().addClass('active');
							} else {
								$(element).parent().removeClass('active');
							}

							var setQty = parseInt($(element).val());
							stockQty -= setQty;
							$(element).parent().find(".sizeQty").text(stockQty);
						}
					},
					All: function () {
						$("#size-section input").each(function () {
							WorkFlow.Validate.Order.Check($(this));
						});
					},
					MOQ: function () {
						let valid = true;
						let totalQty = 0;
						let selectedProducts = FlatDeep(Options.SelectedProducts, Infinity);

						$.each(selectedProducts, function (index, object) {
							totalQty += parseInt(object.Qty);
						});

						$.each(selectedProducts, function (index, object) {
							let name = " for ".concat(object.Name);
							if (object.Name.indexOf(",") > -1) {
								let splittedName = object.Name.split(',');
								name = " for ".concat(splittedName[0]).concat(" of ").concat(splittedName[1]);
							}

							if (object.Min > 0) {
								if (object.Behavior === "AcrossVariants") {
									if (totalQty < object.Min) {
										Utils.Notify({
											style: "warning",
											message: "Minimum of ".concat(object.Min).concat(name).concat(" allowed.")
										});
										valid = false;
									}
								}
								else if (object.Behavior === "PerSku") {
									if (object.Qty < object.Min) {
										Utils.Notify({
											style: "warning",
											message: "Minimum of ".concat(object.Min).concat(name).concat(" allowed.")
										});
										valid = false;
									}
								}
							}

							if (object.Max > 0) {
								if (object.Behavior === "AcrossVariants") {
									if (totalQty > object.Max) {
										Utils.Notify({
											style: "warning",
											message: "Maximum of ".concat(object.Max).concat(name).concat(" allowed.")
										});
										valid = false;
									}
								}
								else if (object.Behavior === "PerSku") {
									if (object.Qty > object.Max) {
										Utils.Notify({
											style: "warning",
											message: "Maximum of ".concat(object.Max).concat(name).concat(" allowed.")
										});
										valid = false;
									}
								}
							}
						});

						return valid;
					}
				}
			},
			Configure: function (btn, type, instantQuoteBranding) {
				Button.Configure(btn, "", true, true); // Proceed

				if (type === undefined || type === "" || instantQuoteBranding === undefined) {
					Button.Reset(btn, "Next");

					Utils.Notify({
						style: "warning",
						message: "Please select an option."
					});
				}
				else {
					Options.Type = type;
					Options.IQBranding = instantQuoteBranding.toString().toLowerCase() === 'true';

					WorkFlow.Steps.Generate(); // Generate step dots

					if (Options.Type === "InstantQuote") { // if instant quote
						if (!Options.IQBranding) // if unbranded
							WorkFlow.Steps.Generate(2);
					} else { // if buy normal
						if (Options.Type === "Unbranded") { // if unbranded
							WorkFlow.Steps.Generate(1);
						}
					}

					$.get(Options.FilterUrl.concat("/workflow/configure"), {
						type: Options.Type,
						documentId: Options.DocumentId
					}).done(function (result) {
						if (!result.Success) {
							Utils.Notify({
								style: "error",
								message: result.Message
							});
						} else {
							if (result.DocumentId > 0) Options.DocumentId = result.DocumentId;

							Load.Positions(btn);

							$('#BuyNow .steps').addClass('show-steps');
						}
					});
				}
			},
			Steps: {
				Generate: function (countOverwrite) {
					let steps = $('.steps').removeClass('centered'), count = steps.attr('data-count');

					if (countOverwrite) {
						count = count - countOverwrite;
					}

					if (count === 1)
						steps.addClass('centered');

					steps.children().remove(); // remove all

					for (let i = 0; i < count; i++) {
						steps.append('<li><span>' + (i + 1) + '</span></li>');
					}

				},
				StepData: function () {
					return {
						steps: $('.steps li'),
						activeSteps: $('.steps li.active')
					};
				},
				Next: function () {
					$('.steps li.active').removeClass('current');
					$(WorkFlow.Steps.StepData().steps[WorkFlow.Steps.StepData().activeSteps.length]).addClass('active current');
					if (window.innerWidth <= 600) {
						$(window).scrollTop($('.masthead.header-b').outerHeight() - $('.top-bar').outerHeight());
					} else {
						$(window).scrollTop(0);
					}
				},
				Back: function () {
					$(WorkFlow.Steps.StepData().steps[WorkFlow.Steps.StepData().activeSteps.length - 2]).addClass('current');
					$(WorkFlow.Steps.StepData().steps[WorkFlow.Steps.StepData().activeSteps.length - 1]).removeClass('active current');
					if (window.innerWidth <= 600) {
						$(window).scrollTop($('.masthead.header-b').outerHeight() - $('.top-bar').outerHeight());
					} else {
						$(window).scrollTop(0);
					}
				}
			},
			Select: {
				Colour: function (element) {
					element = $(element);
					var color = element.attr("data-color");

					var hasSizes = $(".product-size a").length > 0;
					if (hasSizes) {
						$('.product-size').parent().find('label').text('Select a size: ');

						$(".product-size a").each(function (e) {
							var size = $(this).attr("data-size");
							$(this).removeClass('active');
							$(this).parent().find('input[data-size="' + size + '"][type="number"]').val("0");
							$(this).parent().find('input[data-size="' + size + '"][type="number"]').addClass("disabled");

							var stockResult = WorkFlow.Validate.GetOnhand(color, size);
							
							if (stockResult.OnHand === undefined || stockResult.OnHand === NaN) {
								$(this).parent().hide();
							}
							else {
								var span = $(this).parent().find(".stock-check");

								$(this).parent().show();
								$(this).parent().find('input[type="number"]').attr("max", stockResult.OnHand);

								$(span).find("small").text("Stock Available: " + stockResult.OnHand);
								$(span).show();
							}
						});
					}
					else {
						setTimeout(function () {
							var stockResult = WorkFlow.Validate.GetOnhand(color);

							if (stockResult.OnHand !== undefined && stockResult.OnHand !== NaN) {
								$(".product-detail-quantity").find('input[type="number"]').attr("max", stockResult.OnHand);
								var span = $(".product-detail-quantity").parent().find(".stock-check");

								$(span).find("small").text("Stock Available: " + stockResult.OnHand);
								$(span).show();
							}
						}, 500);
					}					
				},
				Size: function (element) {
					var hasColors = $(".product-colour a").length > 0;

					var span = $(element).parent().parent();
					var segmentTitle = span.data('segment-title');
					var segment = span.data('segment');
					var value = $(this).data(segment);

					span.siblings('label').html('Selected ' + segmentTitle + ': ');
					//Product.InitialiseSegments('.product-detail-information ', undefined);

					var segments = $('[data-segment]');
					var actives = segments.find('a.active');

					if (segments.length === actives.length) {
						var selected = '';
						segments.each(function () {
							var s = $(this).data('segment');
							var selectedSegment = $(this).find('a.active');
							selected += '[data-' + s + '="' + selectedSegment.data(s) + '"]';
						});
						var variant = $(selected);
						var variantId = variant.data('variantid');
						var name = variant.data('name');
						var sku = variant.data('sku');

						$('span.product-detail-sku').html('SKU: ' + sku);
						$('[add-to-cart]').data('name', name);
						$('[add-to-cart]').data('product-id', variantId);
						$('[add-to-branding]').data('name', name);
						$('[add-to-branding]').data('product-id', variantId);

						//Check if Bulk price was open
						var opened = $('#collapsePrices').hasClass('in');

						//Remove bulk pricing
						$('.price-display').remove();

						//Display Bulk Pricing
						$.ajax({
							url: '/ProductBulkPrice/BulkPricing',
							data: { productId: variantId },
							success: function (data) {
								if (data.length > 0) {
									$('.product-detail-price').after(data);
									if (opened) $('#collapsePrices').addClass('in');
								}
							},
							error: function () { }
						});

						//Update prices
						$('.product-detail-current-price').html(variant.data('price'));
						if ($('.price-excl-or-incl').data('incl-vat')) {
							$('.price-excl-or-incl').html(variant.data('price-excl'));
						} else {
							$('.price-excl-or-incl').html(variant.data('price-incl'));
						}
					}

					if (actives.length > 0) {
						$(actives).each(function (index) {
							let activeSpan = $(this).parent().parent();
							let activeSegment = activeSpan.data('segment');
							let activeVal = $(this).data(activeSegment);

							if (hasColors) {
								if ($(this).hasClass('size_picker')) {
									var sizeCount = span.siblings('label').find('strong').length;
									if (sizeCount == 0) {
										span.siblings('label').append('<strong>' + activeVal + '</strong>');
									}
									else {
										span.siblings('label').append(', <strong>' + activeVal + '</strong>');
									}
								}
							}
							else {
								if (index == 0) {
									span.siblings('label').append('<strong>' + activeVal + '</strong>');
								}
								else {
									span.siblings('label').append(', <strong>' + activeVal + '</strong>');
								}
							}
						});
					}
				}
			},
			Cancel: function () {
				window.location.replace(Options.Product.Url);
			},
			Next: function (btn) {
				Button.Configure(btn, "", true, true); // Proceed

				let valid = false;
				if (Options.Product.HasNoSegmentation) {
					valid = WorkFlow.Validate.NoSegmentation();
				} else if (Options.Product.HasOnlyColour) {
					valid = WorkFlow.Validate.OnlyColour();
				} else if (Options.Product.HasOnlySize) {
					valid = WorkFlow.Validate.OnlySize();
				} else {
					valid = WorkFlow.Validate.ColourSize();
				}

				if (!valid) {
					if (Options.Type === "Unbranded") {
						Button.Reset(btn, "Add To Cart");
					} else {
						Button.Reset(btn, "Next");
					}
				} else {
					Options.SelectedProducts = FlatDeep(Options.SelectedProducts, Infinity);
				}

				if (Options.Type === "Branded") {
					if (valid) {
						Load.BrandedEnquiry(btn);
					}
				} else if (Options.Type === "InstantQuote" && Options.IQBranding) {
					if (valid) {
						Load.BrandedEnquiry(btn);
					}
				} else if (Options.Type === "InstantQuote" && !Options.IQBranding) {
					if (valid) {
						Load.InstantQuote(btn);
					}
				} else if (Options.Type === "Unbranded") {
					if (valid) {
						WorkFlow.Unbranded.AddToCart(btn);
					}
				}
			},
			Back: function (action) {

				if (action === "position") {
					if (Options.Product.HasOnlyColour || Options.Product.HasNoSegmentation) {
						$("#position-container").hide();
						$("#qty-container").show();
					} else {
						$("#position-container").hide();
						$("#size-container").show();
						WorkFlow.Validate.Order.All();
					}
				}
				else if (action === "position-branding") {
					$("#position-branding-container").hide();
					$("#position-container").show();
				}
				else if (action === "instant-quote") {
					if (Options.IQBranding) {
						$("#instant-quote-container").hide();
						$("#position-branding-container").show();
					} else {
						$("#instant-quote-container").hide();

						if (Options.Product.HasNoSegmentation || Options.Product.HasOnlyColour) {
							$("#qty-container").show();
						} else {
							$("#size-container").show();
							WorkFlow.Validate.Order.All();
						}
					}
				}

				WorkFlow.Steps.Back();
				if ($('#select-workflow fieldset').is(':visible')) {
					$('#BuyNow .steps').removeClass('show-steps');
				}
			},
			Reset: function (btn) {
				Button.Configure(btn, "", true, true); // Proceed
				Button.Configure($(".review-back"), "Back", true, false);
				Button.Configure($(".save-for-later"), "Save For Later", true, false);
				Button.Configure($(".add-to-cart"), "Add To Cart", true, false);

				window.location.href = Options.FilterUrl.concat("/index?productId=", Options.Product.ProductId, "&type=", Options.Type, "&documentId=", Options.DocumentId);
			},
			BeforeAddToCart: function (btn) {
				Button.Configure(btn, "", true, true); // Proceed
				Button.Configure($(".save-for-later"), "Save For Later", true, false);

				WorkFlow.SetEnhancedeCommerce();

				window.location.href = Options.FilterUrl.concat("/beforeaddtocart?documentId=", Options.DocumentId, "&artworkJson=", JSON.stringify(Options.SelectedArtworks));
			},
			PreviousOption: function (count, type) {
				if (count > 1) {
					let previousCount = parseInt(count) - 1;
					if (type === "position-brandings") {
						$("#position-option-".concat(previousCount)).removeClass("hide").show();
						$("#position-option-".concat(count)).hide();
					} else {
						$("#option-".concat(previousCount)).removeClass("hide").show();
						$("#option-".concat(count)).hide();
					}
				}
				UI.Select2($(".js-select"), { minimumResultsForSearch: Infinity });
			},
			NextOption: function (count, max, type) {
				if (count !== max) {
					let nextCount = parseInt(count) + 1;
					if (type === "position-brandings") {
						$("#position-option-".concat(count)).hide();
						$("#position-option-".concat(nextCount)).removeClass("hide").show();
					} else {
						$("#option-".concat(count)).hide();
						$("#option-".concat(nextCount)).removeClass("hide").show();
					}
				}
				UI.Select2($(".js-select"), { minimumResultsForSearch: Infinity });
			},
			Process: function (btn) {
				Button.Configure(btn, "", true, true); // Proceed

				if (Options.Type === "Branded") {
					let artworksValid = true; //WorkFlow.Validate.Artworks(btn);
					let positionBrandingsValid = WorkFlow.Validate.PositionBrandings(btn);
					let numberOfColoursValid = WorkFlow.Validate.NumberOfColours(btn);

					if (artworksValid && positionBrandingsValid && numberOfColoursValid) {
						WorkFlow.Save(btn);
					}
				} else if (Options.Type === "InstantQuote") {
					let valid = WorkFlow.Validate.InstantQuote(btn);

					if (valid) {
						WorkFlow.Save(btn);
					}
				}
			},
			Save: function (btn) {
				$.post(Options.FilterUrl.concat("/save"), {
					type: Options.Type,
					documentId: Options.DocumentId,
					products: Options.SelectedProducts,
					positions: Options.SelectedPositions,
					numberOfColours: Options.SelectedNumberOfColours,
					instantQuoteBranding: Options.IQBranding,
					quote: Options.IQDetails,
					tracking: Options.GaConnector
				}).done(function (result) {
					if (!result.Success) {
						Button.Reset(btn, "Add To Cart");

						Utils.Notify({
							style: "error",
							message: result.Message
						});
					} else {
						WorkFlow.BeforeAddToCart($(this));
					}
				});
			},
			SetArtwork: function (oldArtworkId, newArtworkId, positionId) {
				$("#artworkModal .modal-body").html("<div class='text-center'><img style='height: 125px;' src='".concat(Options.LoaderUrl, "' /></div>"));

				$.get(Options.FilterUrl.concat("/artwork/setartwork"), {
					oldArtworkId: oldArtworkId,
					newArtworkId: newArtworkId,
					documentId: Options.DocumentId,
					positionId: positionId
				}).done(function (result) {
					if (!result.Success) {
						Utils.Notify({
							style: "error",
							message: result.Message
						});
					} else {
						$("#position-artwork-image-".concat(positionId)).removeClass("hide").attr("src", result.Url.concat("?v=", Math.floor(Math.random() * 10000)));

						if (result.ArtworkId > 0) {
							$("#position-artwork-id-".concat(positionId)).val(result.ArtworkId);

							for (let i = 0; i < Options.SelectedArtworks.length; i++) {
								if (Options.SelectedArtworks[i].ArtworkId === result.ArtworkId &&
									Options.SelectedArtworks[i].PositionId === result.PositionId) {
									Options.SelectedArtworks.splice(i, 1);
								}
							}

							Options.SelectedArtworks.push({
								ArtworkId: result.ArtworkId,
								PositionId: result.PositionId
							});
						}

						$("#position-artwork-image-".concat(positionId)).parents('.brand-box').find('.position-title').addClass('progress-done ArtWorkUploaded');
						$("#artworkModal").modal("toggle");
						if ($('.ArtWorkUploaded').length === $('.position-options').length) {
							$(window).scrollTop($('#position-branding-actions').offset().top - window.outerHeight + $('header').outerHeight());
						}
					}
				});
			},
			InstantQuote: {
				Email: function (btn) {
					Button.Configure(btn, "Sending...", true, true);
					Button.Configure($(".review-back"), "Back", true, false);
					Button.Configure($(".instant-quote-add-to-cart"), "Add To Cart", true, false);
					Button.Configure($(".start-again"), "Start Again", true, false);

					$.post(Options.FilterUrl.concat("/send-instantquote-email"), {
						documentId: Options.DocumentId,
						quote: Options.IQDetails
					}).done(function (result) {
						Button.Reset(btn, '<i class="fa fa-envelope"></i> Email Me This Quote');
						Button.Reset($(".review-back"), "Back");
						Button.Reset($(".instant-quote-add-to-cart"), "Add To Cart");
						Button.Reset($(".start-again"), "Start Again");

						Utils.Notify({
							style: result.Success ? "success" : "error",
							message: result.Message
						});
					});
				},
				AddToCart: function (btn) {
					Button.Configure(btn, "", true, true); // Proceed
					Button.Configure($(".review-back"), "Back", true, false);
					Button.Configure($(".email-quote"), '<i class="fa fa-envelope"></i> Email Me This Quote', true, false);
					Button.Configure($(".start-again"), "Start Again", true, false);

					$.get(Options.FilterUrl.concat("/instantquote-addtocart"), {
						documentId: Options.DocumentId
					}).done(function (result) {
						window.location.href = result.ApolloUrl;
					});
				}
			},
			Unbranded: {
				AddToCart: function () {
					let valid = WorkFlow.Validate.BuildProducts(false);

					if (valid) {
						WorkFlow.Cart.BulkAdd();
					}
				},
			},
			Branded: {
				Redirect: function (btn) {
					let valid = WorkFlow.Validate.BuildProducts(true);

					if (valid) {
						var url = $(btn).attr("data-url");
						//window.location.href = url;

						$("#brandingModalBody").load(url);
						$("#product-branding-modal").modal("toggle");
					}
				}
			},
			SetEnhancedeCommerce: function () {
				//Google Analytics
				if (window.SFGA) SFGA.Event('add_to_cart', null, '/ajax/google-analytics-4/cart');

				//Facebook Pixel
				fbq('track', 'AddToCart');
			},
			Cart: {
				BulkAdd: function () {
					$.ajax({
						type: 'post',
						url: '/bulk-add-to-cart',
						cache: false,
						dataType: 'json',
						headers: {
							Accept: 'application/json'
						},
						data: {
							items: Options.SelectedProducts
						},
						success: function (result) {
							let style = result.success ? "cart" : "error";
							let msg = 'Could not add one or more products to your cart.';

							if (result.success)
								msg = 'You successfully added <strong> product(s) </strong> to your cart.';
							else if (typeof result.message !== 'undefined' && result.message.length > 0)
								msg = result.message;

							Utils.Notify({
								message: msg,
								style: style,
								expires: 120000
							});

							sdk.cart.get({
								success: function (response) {
									var data = response.data;

									if (data) {
										var cartModel = {
											HasItems: data.ItemCount > 0,
											Items: data.Items.map(function (item) {
												let cartItem = new Object;

												// Get the picture if batch item
												if (item.Children != undefined) {
													for (var i = 0; i < item.Children.length; i++) {
														let sku = item.Children[i].Sku;

														if (sku != undefined && sku != null) {
															if (item.Children[i] !== null && item.Children[i] !== undefined) {
																if (item.Children[i].Pictures !== undefined && item.Children[i].Pictures[0] !== null && item.Children[i].Pictures.length > 0) {
																	cartItem.Picture = item.Children[i].Pictures[0].Url;
																}
															}
														}
													}
												}

												return {
													Id: item.ItemId,
													Url: item.Url,
													Picture: item.Children != undefined ? cartItem.Picture : item.Pictures[0].Url,
													Name: item.Description,
													Qty: item.Qty,
													Price: currencyParse(item.Total)
												}
											}),
											Total: currencyParse(data.Total)
										}

										if (localStorage.getItem("cart-checksum") == null) {
											localStorage.setItem("cart-checksum", data.Checksum)
											localStorage.setItem("cart-refresh", true);
										}
										else {
											if (data.Checksum != localStorage.getItem("cart-checksum")) {
												localStorage.setItem("cart-checksum", data.Checksum)
												localStorage.setItem("cart-refresh", true);
											} else {
												localStorage.setItem("cart-refresh", false);
											}
										}

										fbq('track', 'AddToCart');

										$('minicart').html(Mustache.render($('#minicart_html').html(), $.extend({}, data, cartModel)));
									}
									else {
										$('minicart').html(Mustache.render($('#minicart_html').html(), { ItemCount: 0 }));
									}
								},
								error: function (error) { console.error("Error Loading Minicart:", error) }
							});
						},
						error: function (xhr, error) {
							console.error(error);
						}
					});
				}
			},
			Events: function () {
				$("#brandedEnquiryForm").on('submit', function (e) {
					e.preventDefault();

					var form = $(this);

					$.ajax({
						url: Options.FilterUrl.concat("/send-branded-enquiry-email"),
						method: 'POST',
						data: form.serialize(),
						async: true,
						beforeSend: function () {
							UI.Loader.Show({
								text: 'Submitting'
							});
						},
						success: function (result) {
							if (result.Success) {
								Utils.Notify({
									style: "success",
									message: "Your form has been submitted successfully"
								});

								setTimeout(function () {
									WorkFlow.Cancel();
								}, 3000);
							}
							else {
								Utils.Notify({
									style: "error",
									message: result.Message
								});
							}
						},
						error: function (e) {
							console.error(e);
							Utils.Notify({
								style: "error",
								message: "Something went wrong. If the issue persists, please contact the administrator."
							});
						},
						complete: function () {
							UI.Loader.Hide();
						}
					});
				});

				$('.size_picker').on("click", function (e) {
					e.stopImmediatePropagation();

					var sizePicker = $(this);
					var sizePickerInput = $(this).parent().find('.sizePickerQty');

					var hasColors = $(".product-colour a").length > 0;
					var color = $(".product-colour a.active").data("color");
					var colorName = $(".product-colour").data("segment-title");

					if (hasColors) {
						if (color == undefined) {
							Utils.Notify({
								style: "warning",
								message: "Please select a " + colorName + " before selecting a size"
							});

							$(sizePicker).removeClass("active");
							$(sizePickerInput).addClass("disabled");
							$(sizePickerInput).val(0);
						}
						else {
							if ($(sizePicker).hasClass('disabled')) {
								Utils.Notify({
									style: "warning",
									message: "Sorry, this item is currently out of stock"
								});

								$(sizePicker).removeClass("active");
								$(sizePickerInput).addClass("disabled");
								$(sizePickerInput).val(0);

								WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');
							}
							else {
								if ($(sizePicker).hasClass('active')) {
									$(sizePicker).removeClass("active");
									$(sizePickerInput).addClass("disabled");
									$(sizePickerInput).val(0);

									WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');
								}
								else {
									$(sizePicker).addClass("active");
									$(sizePickerInput).removeClass("disabled");
									$(sizePickerInput).val(1);

									WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');
								}
							}
						}
					}
					else {
						if ($(sizePicker).hasClass('disabled')) {
							Utils.Notify({
								style: "warning",
								message: "Sorry, this item is currently out of stock"
							});

							$(sizePicker).removeClass("active");
							$(sizePickerInput).addClass("disabled");
							$(sizePickerInput).val(0);

							WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');
						}
						else {
							if ($(sizePicker).hasClass('active')) {
								$(sizePicker).removeClass("active");
								$(sizePickerInput).addClass("disabled");
								$(sizePickerInput).val(0);
							}
							else {
								$(sizePicker).addClass("active");
								$(sizePickerInput).removeClass("disabled");
								$(sizePickerInput).val(1);

								WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');
							}
						}
					}
				});

				$('.sizePickerQty').on("change", function () {
					var label = $(this).parent().siblings('label');
					var segmentTitle = $(this).parent().data('segment-title');

					var sizePicker = $(this).parent().find('.size_picker');
					var sizePickerInput = $(this);

					var qty = parseInt($(sizePickerInput).val());
					var maxQty = parseInt($(sizePickerInput).prop("max"));
					var hasColors = $(".product-colour a").length > 0;

					if (isNaN(qty)) {
						Utils.Notify({
							style: "warning",
							message: "Please enter a valid quantity"
						});

						$(sizePicker).removeClass("active");
						$(sizePickerInput).addClass("disabled");
						$(sizePickerInput).val(0);

						WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

						return false;
					}

					if (hasColors) {
						var color = $(".product-colour a.active").data("color");
						var colorName = $(".product-colour").data("segment-title");

						//Validate color selected
						if (color == undefined) {
							Utils.Notify({
								style: "warning",
								message: "Please select a " + colorName + " before selecting a size"
							});

							$(sizePicker).removeClass("active");
							$(sizePickerInput).addClass("disabled");
							$(sizePickerInput).val(0);

							WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

							return false;
						}
						else {
							if (qty > 0 && maxQty > 0) {
								if (qty > maxQty) {
									$(sizePickerInput).val(maxQty);
									Utils.Notify({
										style: "warning",
										message: "You cannot select more than the available stock"
									});
								}

								if (!$(sizePicker).hasClass('disabled')) {
									$(sizePicker).addClass("active");
									$(sizePickerInput).removeClass("disabled");

									WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

									return true;
								}
								else {
									Utils.Notify({
										style: "warning",
										message: "Sorry, this item is currently out of stock"
									});

									$(sizePicker).removeClass("active");
									$(sizePickerInput).addClass("disabled");
									$(sizePickerInput).val(0);

									WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

									return false;
								}
							}
							else if (qty > 0 && maxQty <= 0) {
								Utils.Notify({
									style: "warning",
									message: "Sorry, this item is currently out of stock"
								});

								$(sizePicker).removeClass("active");
								$(sizePickerInput).addClass("disabled");
								$(sizePickerInput).val(0);

								WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

								return false;
							}
							else if (qty == 0) {
								$(sizePicker).removeClass("active");
								$(sizePickerInput).addClass("disabled");
								$(sizePickerInput).val(0);
								label.html('Select a ' + segmentTitle + ': ');

								return true;
							}

						}
					}
					else {
						if (qty > 0 && maxQty > 0) {
							if (!$(sizePicker).hasClass('disabled')) {
								$(sizePicker).addClass("active");
								$(sizePickerInput).removeClass("disabled", "");

								WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

								return true;
							}
							else {
								Utils.Notify({
									style: "warning",
									message: "Sorry, this item is currently out of stock"
								});

								$(sizePicker).removeClass("active");
								$(sizePickerInput).addClass("disabled");
								$(sizePickerInput).val(0);

								WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

								return false;
							}
						}
						else if (qty > 0 && maxQty <= 0) {
							Utils.Notify({
								style: "warning",
								message: "Sorry, this item is currently out of stock"
							});

							$(sizePicker).removeClass("active");
							$(sizePickerInput).addClass("disabled");
							$(sizePickerInput).val(0);

							WorkFlow.Select.Size('.product-detail-form-list .product-detail-form-row .product-size a');

							return false;
						}
						else if (qty == 0) {
							$(sizePicker).removeClass("active");
							$(sizePickerInput).addClass("disabled");
							$(sizePickerInput).val(0);
							label.html('Select a ' + segmentTitle + ': ');

							return false;
						}
					}
				});

				$('.product-colour a[data-color]').on('click', function (e) {
					e.stopImmediatePropagation();

					$(this).closest('.product-detail-form-row')
						.find('.control-label strong')
						.text($(this).attr('data-color'));

					$(this).closest('.segment').find('a').removeClass('active');
					$(this).addClass('active selected');

					BuyNow.WorkFlow.Select.Colour(this);

					var color = $(this).attr("data-color");
					$('[data-thumbnail-color="' + color + '"]').click();

					ImageDownloadChange();
				});
			}
		},

		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		},

		FlatDeep = function (arr, d = 1) {
			return d > 0 ? arr.reduce((acc, val) => acc.concat(Array.isArray(val) ? FlatDeep(val, d - 1) : val), [])
				: arr.slice();
		}
	return {
		Initialize: Initialize,
		Load: Load,
		WorkFlow: WorkFlow
	}
})(jQuery);
/**
 * This script lives in the parent window.
 */
 
window.EmbedManager = window.EmbedManager || new function() {
	var FRAME_NAME_PREFIX = "frame-one";
	
	var _addListener = function(obj, name, fn) {
		if(obj.addEventListener) {
			obj.addEventListener(name, fn, false);
		} else if(obj.attachEvent) {
			obj.attachEvent("on" + name, fn);
		}
	}
	
	var _embeds = {};
	
	_addListener(document, "touchmove", function(evn) {
		// android chrome scrolling fix
	});
	
	_addListener(window, "message", function(evn) {
		if (evn.data !== "undefined" && evn.data !== null && evn.data.length > 0) {
		var parts = evn.data.split(':');
		
		// expect [id, height, scroll]
		if(parts.length === 3) {
			var embed = _embeds[parts[0]];
			
			if(embed) {
				var frame = document.getElementById(FRAME_NAME_PREFIX + parts[0]);
				
				if(frame) {
					if (frame.height !== parts[1]) {
						frame.height = parts[1]; 
						embed.callback();
					}
					
					if(embed.hits++ > 0) {
						if(parts[2] === "true"){
							EmbedManager.scrollPage(parts[0]);
						}
					}
				} else {
					alert("embed frame " + parts[0] + " could not be found");
				}
			}
		}
		}
	});
	
	return {
		embed: function(params) {
			var embedKey = params.key.replace(/&#038;|&amp;/g, "&"); // fix for CMS (WordPress, etc) double encoding
			var embedId = embedKey.substr(embedKey.indexOf('&') + 1);
			var embedUrl = embedKey + "&EmbedId=" + embedId;
			var embedCallback = params.resizeCallback || function() {};
			var embedWidth = params.width || "100%";
			
			// assume width is px if no units
			if(embedWidth.indexOf('%') < 0 && embedWidth.indexOf("px") < 0) {
				embedWidth += "px";
			}
			
			if(params.showFormLogin) {
				if (embedUrl.indexOf("https:") < 0) {
					embedUrl = "https:" + embedUrl.substr(5); // replace http with https
				}
				
				embedUrl += "&ShowFormLogin";
			}
			
			if (params.prePopulate) {
				embedUrl += "&PrePopulate";
			
				for (var i in params.prePopulate) {
					embedUrl += '&' + i + '=' + encodeURIComponent(params.prePopulate[i]);
				}
			}
			
			if(params.mobileResponsive) {
				embedUrl += "&MobileResponsive";
			}
			
			_embeds[embedId] = { id:embedId, url:embedUrl, callback:embedCallback, hits:0 };
			
			EmbedManager.createFrame(embedId, embedUrl, embedWidth);
		},
		
		createFrame: function(embedId, embedUrl, embedWidth) {
			var anc = document.getElementById("formAnchor" + embedId);
			var frame = document.createElement("iframe");
			
			frame.allowTransparency = true;
			frame.frameBorder = 0;
			frame.id = "frame-one" + embedId;
			frame.scrolling = "no";
			frame.src = embedUrl;
			frame.style.border = 0;
			frame.style.margin = 0;
			frame.style.padding = 0;
			frame.style.width = embedWidth;
			
			//anc.parentNode.insertBefore(frame, anc);
		},
		
		scrollPage: function(embedId) {
			function findPos(el) {
				var left = 0;
				var top = 0;
				
				if (el.offsetParent) {
					do {
						left += el.offsetLeft;
						top += el.offsetTop;
					} while (el = el.offsetParent);
					
					return { X:left, Y:top };
				}
			}
			
			var frame = document.getElementById(FRAME_NAME_PREFIX + embedId);
			var framePos = findPos(frame);
			var scrollY = window.pageYOffset || document.documentElement.scrollTop
			
			if(scrollY > framePos.Y) {
				// scroll top of form into view
				window.scrollTo(framePos.X, framePos.Y);
			}
		}
	};
}();
var GaConnector = (function ($) {
	let Options = {
		Data: null,
		ExpireDays: 1
	},
		Initialize = function () {
			let cookieData = Cookie.GetData();
			Options.Data = cookieData;

			Cookie.Set("_ga.started", new Date().getTime(), Options.ExpireDays);

			let ga = Cookie.Get("_ga");
			if (ga === undefined) ga = "NA";

			Api.Execute("/api/store/creativebrands/gaconnector?gaClientId=".concat(ga, "&timeZone=", Intl.DateTimeFormat().resolvedOptions().timeZone), "GET", {
				resp200: function (data) {
					Cookie.SetData(JSON.parse(data), cookieData);
				},
				resp400: function (data) {
					console.error(data);
				},
				resp401: function (data) {
					console.error(data);
				},
				resp403: function (data) {
					console.error(data);
				},
				resp500: function (data) {
					console.error(data);
				}
			});
		},

		WorkFlow = {
			Terminate: function (email) {
				WorkFlow.CalculateTime();
				Api.Execute("/api/store/creativebrands/gaconnector/terminate?email=".concat(email), "GET");
			},
			CalculateTime: function () {
				let startTime = parseInt(Cookie.Get("_ga.started"));

				let endTime = new Date().getTime();
				Cookie.Set("_ga.ended", endTime, Options.ExpireDays);

				let diffTime = endTime - startTime;
				if (diffTime !== isNaN) {
					Cookie.Set("time_passed", diffTime, Options.ExpireDays);
					Options.Data.TimePassed = diffTime;
				}
			}
		},

		Cookie = {
			Get: function (name) {
				let value = "; " + document.cookie;
				let parts = value.split("; " + name + "=");

				if (parts.length === 2)
					return parts.pop().split(";").shift();
			},
			Set: function (name, value, exdays) {
				let d = new Date();
				d.setDate(d.getDate() + exdays);
				let expires = "expires=" + d.toUTCString();
				document.cookie = name + "=" + value + ";" + expires + ";path=/";
			},
			GetData: function () {
				let cookieData = new Object();

				cookieData.GaClientId = Cookie.Get("GA_Client_ID");
				cookieData.OperatingSystem = Cookie.Get("OS");
				cookieData.Browser = Cookie.Get("browser");
				cookieData.City = Cookie.Get("city");
				cookieData.Country = Cookie.Get("country");
				cookieData.Device = Cookie.Get("device");
				cookieData.PageVisits = Cookie.Get("page_visits");
				cookieData.PagesVisitedList = Cookie.Get("pages_visited_list");
				cookieData.Region = Cookie.Get("region");
				cookieData.TimeZone = Cookie.Get("time_zone");
				cookieData.TimePassed = Cookie.Get("time_passed");
				cookieData.Latitude = Cookie.Get("latitude");
				cookieData.Longitude = Cookie.Get("longitude");
				cookieData.Campaign = Cookie.Get("fc_campaign");
				cookieData.Channel = Cookie.Get("fc_channel");
				cookieData.Content = Cookie.Get("fc_content");
				cookieData.Landing = Cookie.Get("fc_landing");
				cookieData.Medium = Cookie.Get("fc_medium");
				cookieData.Source = Cookie.Get("fc_source");
				cookieData.Term = Cookie.Get("fc_term");
				cookieData.Term = Cookie.Get("sessionId");

				return cookieData;
			},
			SetData: function (model, cookieData) {
				if (model !== undefined) {
					Options.Data = model;

					Cookie.Set("GA_Client_ID", Options.Data.GaClientId, Options.ExpireDays);
					Cookie.Set("OS", Options.Data.OperatingSystem, Options.ExpireDays);
					Cookie.Set("browser", Options.Data.Browser, Options.ExpireDays);
					Cookie.Set("city", Options.Data.City, Options.ExpireDays);
					Cookie.Set("country", Options.Data.Country, Options.ExpireDays);
					Cookie.Set("device", Options.Data.Device, Options.ExpireDays);
					Cookie.Set("page_visits", Options.Data.PageVisits, Options.ExpireDays);
					Cookie.Set("pages_visited_list", Options.Data.PagesVisitedList, Options.ExpireDays);
					Cookie.Set("region", Options.Data.Region, Options.ExpireDays);
					Cookie.Set("time_zone", Options.Data.TimeZone, Options.ExpireDays);
					Cookie.Set("latitude", Options.Data.Latitude, Options.ExpireDays);
					Cookie.Set("longitude", Options.Data.Longitude, Options.ExpireDays);
					Cookie.Set("sessionId", Options.Data.SessionId, Options.ExpireDays);

					if (cookieData.Campaign === undefined || cookieData.Campaign === '') {
						Cookie.Set("fc_campaign", Options.Data.Campaign, Options.ExpireDays);
						Cookie.Set("lc_campaign", Options.Data.Campaign, Options.ExpireDays);
					}

					if (cookieData.Channel === undefined || cookieData.Channel === '') {
						Cookie.Set("fc_channel", Options.Data.Channel, Options.ExpireDays);
						Cookie.Set("lc_channel", Options.Data.Channel, Options.ExpireDays);
					}

					if (cookieData.Content === undefined || cookieData.Content === '') {
						Cookie.Set("fc_content", Options.Data.Content, Options.ExpireDays);
						Cookie.Set("lc_content", Options.Data.Content, Options.ExpireDays);
					}

					if (cookieData.Landing === undefined || cookieData.Landing === '') {
						Cookie.Set("fc_landing", Options.Data.Landing, Options.ExpireDays);
						Cookie.Set("lc_landing", Options.Data.Landing, Options.ExpireDays);
					}

					if (cookieData.Medium === undefined || cookieData.Medium === '') {
						Cookie.Set("fc_medium", Options.Data.Medium, Options.ExpireDays);
						Cookie.Set("lc_medium", Options.Data.Medium, Options.ExpireDays);
					}

					if (cookieData.Source === undefined || cookieData.Source === '') {
						Cookie.Set("fc_source", Options.Data.Source, Options.ExpireDays);
						Cookie.Set("lc_source", Options.Data.Source, Options.ExpireDays);
					}

					if (cookieData.Term === undefined || cookieData.Term === '') {
						Cookie.Set("fc_term", Options.Data.Term, Options.ExpireDays);
						Cookie.Set("lc_term", Options.Data.Term, Options.ExpireDays);
					}
				}
			}
		},

		Get = function () {
			return Options.Data;
		}

	return {
		Initialize: Initialize,
		WorkFlow: WorkFlow,
		GetByName: Cookie.Get,
		Get: Get
	}
})(jQuery);
!function (t) { "use strict"; "function" === typeof define && define.amd ? define(["jquery"], t) : "undefined" !== typeof module && module.exports ? module.exports = t(require("jquery")) : t(jQuery) }(function (t) { var e = -1, o = -1, a = function (t) { return parseFloat(t) || 0 }, n = function (e) { var o = t(e), n = null, i = []; return o.each(function () { var e = t(this), o = e.offset().top - a(e.css("margin-top")), r = i.length > 0 ? i[i.length - 1] : null; null === r ? i.push(e) : Math.floor(Math.abs(n - o)) <= 1 ? i[i.length - 1] = r.add(e) : i.push(e), n = o }), i }, i = function (e) { var o = { byRow: !0, property: "height", target: null, remove: !1 }; return "object" === typeof e ? t.extend(o, e) : ("boolean" === typeof e ? o.byRow = e : "remove" === e && (o.remove = !0), o) }, r = t.fn.matchHeight = function (e) { var o = i(e); if (o.remove) { var a = this; return this.css(o.property, ""), t.each(r._groups, function (t, e) { e.elements = e.elements.not(a) }), this } return this.length <= 1 && !o.target ? this : (r._groups.push({ elements: this, options: o }), r._apply(this, o), this) }; r.version = "master", r._groups = [], r._throttle = 80, r._maintainScroll = !1, r._beforeUpdate = null, r._afterUpdate = null, r._rows = n, r._parse = a, r._parseOptions = i, r._apply = function (e, o) { var s = i(o), h = t(e), l = [h], c = t(window).scrollTop(), p = t("html").outerHeight(!0), u = h.parents().filter(":hidden"); return u.each(function () { var e = t(this); e.data("style-cache", e.attr("style")) }), u.css("display", "block"), s.byRow && !s.target && (h.each(function () { var e = t(this), o = e.css("display"); "inline-block" !== o && "flex" !== o && "inline-flex" !== o && (o = "block"), e.data("style-cache", e.attr("style")), e.css({ display: o, "padding-top": "0", "padding-bottom": "0", "margin-top": "0", "margin-bottom": "0", "border-top-width": "0", "border-bottom-width": "0", height: "100px", overflow: "hidden" }) }), l = n(h), h.each(function () { var e = t(this); e.attr("style", e.data("style-cache") || "") })), t.each(l, function (e, o) { var n = t(o), i = 0; if (s.target) i = s.target.outerHeight(!1); else { if (s.byRow && n.length <= 1) return void n.css(s.property, ""); n.each(function () { var e = t(this), o = e.attr("style"), a = e.css("display"); "inline-block" !== a && "flex" !== a && "inline-flex" !== a && (a = "block"); var n = { display: a }; n[s.property] = "", e.css(n), e.outerHeight(!1) > i && (i = e.outerHeight(!1)), o ? e.attr("style", o) : e.css("display", "") }) } n.each(function () { var e = t(this), o = 0; s.target && e.is(s.target) || ("border-box" !== e.css("box-sizing") && (o += a(e.css("border-top-width")) + a(e.css("border-bottom-width")), o += a(e.css("padding-top")) + a(e.css("padding-bottom"))), e.css(s.property, i - o + "px")) }) }), u.each(function () { var e = t(this); e.attr("style", e.data("style-cache") || null) }), r._maintainScroll && t(window).scrollTop(c / p * t("html").outerHeight(!0)), this }, r._applyDataApi = function () { var e = {}; t("[data-match-height], [data-mh]").each(function () { var o = t(this), a = o.attr("data-mh") || o.attr("data-match-height"); e[a] = a in e ? e[a].add(o) : o }), t.each(e, function () { this.matchHeight(!0) }) }; var s = function (e) { r._beforeUpdate && r._beforeUpdate(e, r._groups), t.each(r._groups, function () { r._apply(this.elements, this.options) }), r._afterUpdate && r._afterUpdate(e, r._groups) }; r._update = function (a, n) { if (n && "resize" === n.type) { var i = t(window).width(); if (i === e) return; e = i } a ? -1 === o && (o = setTimeout(function () { s(n), o = -1 }, r._throttle)) : s(n) }, t(r._applyDataApi); var h = t.fn.on ? "on" : "bind"; t(window)[h]("load", function (t) { r._update(!1, t) }), t(window)[h]("resize orientationchange", function (t) { r._update(!0, t) }) });
$(function () {

	// Client, team tooltips
	$(".section-d li a, .section-e li a").popover({ trigger: "manual", html: true, animation: false })
		.on("mouseenter", function () {
			var _this = this;
			$(this).popover("show");
			$(".popover").on("mouseleave", function () {
				$(_this).popover('hide');
			});
		}).on("mouseleave", function () {
			var _this = this;
			if (!$(".popover:hover").length) {
				$(_this).popover("hide");
			}
		});

	$('[data-mh="product-mod"]').matchHeight();
	$(".project-mod-full").matchHeight();

	removeToggle();
});

$(window).resize(function () {
	removeToggle();
});

function removeToggle() {
	if ($(window).width() < 500) {
		$(".mini-cart .dropdown-toggle").removeAttr("dropdown-toggle");
	}
}

function setCookie(cname, cvalue, exdays) {
	var d = new Date();
	d.setTime(d.getTime() + (exdays * 24 * 60 * 60 * 1000));
	var expires = "expires=" + d.toUTCString();
	document.cookie = cname + "=" + cvalue + ";" + expires + ";path=/";
}

function getCookie(cname) {
	var name = cname + "=";
	var decodedCookie = decodeURIComponent(document.cookie);
	var ca = decodedCookie.split(';');
	for (var i = 0; i < ca.length; i++) {
		var c = ca[i];
		while (c.charAt(0) === ' ') {
			c = c.substring(1);
		}
		if (c.indexOf(name) === 0) {
			return c.substring(name.length, c.length);
		}
	}
	return "";
}

var CustomOptin = (function () {

    var _performance = false;
    var _functional = false;
    var _targeting = false;

    var _performanceKeys = {}
    var _functionalKeys = {}
    var _targetingKeys = {}

    var _customRegistrations = new Array();

    var _optinSettings = {

    };

    var init = function (settings) {

        //extend the settings
        functions.ExtendSetting(settings);

        $(document).ready(function () {

            //load the settings
            var settings = functions.LoadSettings();

            //build the html
            var bannerHtml = functions.BuildBannerHtml();
            var modalHtml = functions.BuildModalHtml();

            //append the checkbox styles
            $('body').append('<style type="text/css">.form-switch{display:inline-block;cursor:pointer;-webkit-tap-highlight-color:transparent;float:right}.form-switch i{position:relative;display:inline-block;margin-right:.5rem;width:46px;height:26px;background-color:#e6e6e6;border-radius:23px;vertical-align:text-bottom;transition:all .3s linear}.form-switch i::before{content:"";position:absolute;left:0;width:42px;height:22px;background-color:#fff;border-radius:11px;transform:translate3d(2px,2px,0) scale3d(1,1,1);transition:all .25s linear}.form-switch i::after{content:"";position:absolute;left:0;width:22px;height:22px;background-color:#fff;border-radius:11px;box-shadow:0 2px 2px rgba(0,0,0,.24);transform:translate3d(2px,2px,0);transition:all .2s ease-in-out}.form-switch:active i::after{width:28px;transform:translate3d(2px,2px,0)}.form-switch:active input:checked+i::after{transform:translate3d(16px,2px,0)}.form-switch input{display:none}.form-switch input:checked+i{background-color:#4bd763}.form-switch input:checked+i::before{transform:translate3d(18px,2px,0) scale3d(0,0,0)}.form-switch input:checked+i::after{transform:translate3d(22px,2px,0)}</style>');

            //inject the banner html on the page
            $('body').append(bannerHtml);
            $('body').append(modalHtml);

            //apply the settings
            functions.ApplySettings(settings, true);

            //bind the onclicks
            functions.BindClicks();

            if (!settings.consent) {

                setTimeout(function () {

                    $('#sfc').css('bottom', '0px');

                }, 1000);

                return;
            }

            //apply the settings
            functions.ApplySettings(settings, false);
        });
    };

    var functions = {

        AllowPerformance: function () {
            return _performance;
        },

        AllowFunctional: function () {
            return _functional;
        },

        AllowTargeting: function () {
            return _targeting;
        },

        ExtendSetting: function (settings) {
            _optinSettings = $.extend({
                defaults: {
                    performance: true,
                    functional: false,
                    targeting: false,
                    consent: false
                },
                config: {
                    html: 'By clicking “Accept All Cookies”, you agree to the storing of cookies on your device to enhance site navigation, analyze site usage, and assist in our marketing efforts.',
					acceptButtonText: 'Accept All Cookies',
					settingsButtonText: 'Cookies Settings'
                },
                styling: {

                    root: {
                        transition: '1s ease all',
                        'background-color': '#FFFFFF',
                        position: 'fixed',
                        'z-index': '1040',
                        bottom: '-200px',
                        right: '0',
                        left: '0',
                        'max-height': '90%',
                        'overflow-x': 'hidden',
                        'overflow-y': 'auto',
                        'box-shadow': '0 0 18px rgb(0 0 0 / 20%)'
                    },
                    container: {

                        width: '100%',
                        padding: '0',
                        position: 'relative',
                        'max-width': '100%',
                        margin: '0 auto',
                        'box-sizing': 'border-box'
                    },
                    sdkRow: {
                        margin: '0',
                        'max-width': 'none',
                        display: 'block'
                    },
                    sdkContainer: {
                        width: '56%',
                        'margin-left': '0',
                        float: 'left',
                        'box-sizing': 'border-box',
                        padding: '0',
                        display: 'initial'
                    },
                    policy: {
                        'margin-left': '2em',
                        margin: '1.25em 0 .625em 2em',
                        overflow: 'hidden'
                    },
                    buttonGroupParent: {
                        width: '44%',
                        'padding-left': '2%',
                        'padding-right': '2%',
                        margin: 'auto',
                        'min-height': '1px',
                        'text-align': 'center',
                        float: 'left',
                        'box-sizing': 'border-box',
                        padding: '0',
                        display: 'initial'
                    },
                    buttonGroup: {
                        display: 'inline-block',
                        'margin-right': 'auto'
                    },
                    cookieSettingsButton: {
                        color: '#8f8f8f',
                        'border-color': '#8f8f8f',
                        'background-color': '#FFFFFF',
                        border: 'none',
                        'text-decoration': 'underline',
                        'padding-left': '0',
                        'margin-top': '1em',
                        'margin-right': '1em',
                        'min-width': '125px',
                        height: 'auto',
                        'white-space': 'normal',
                        'word-break': 'break-word',
                        'word-wrap': 'break-word',
                        padding: '12px 10px',
                        'font-weight': '600',
                        cursor: 'pointer',
                        'box-sizing': 'border-box'
                    },
                    acceptButton: {
                        'background-color': '#000000',
                        'border-color': '#000000',
                        color: '#FFFFFF',
                        'margin-top': '1em',
                        'margin-right': '1em',
                        'min-width': '125px',
                        height: 'auto',
                        'white-space': 'normal',
                        'word-break': 'break-word',
                        'word-wrap': 'break-word',
                        padding: '12px 10px',
                        'line-height': '1.2',
                        'font-size': '.813em',
                        'font-weight': '600',
                        'border-radius': '2px',
                        border: '1px solid #bbb',
                        cursor: 'pointer',
                        'box-sizing': 'border-box',
                        'letter-spacing': '0.01em',
                        'text-decoration': 'none',
                        'text-align': 'center',
                        'margin-bottom': '1rem'
                    }
                }

            }, settings);
        },

        BuildBannerHtml: function () {

            //#region css replacements

            var rootCss = '';
            for (var c in _optinSettings.styling.root) {
                rootCss += c + ':' + _optinSettings.styling.root[c] + ';';
            }

            var containerCss = '';
            for (var c in _optinSettings.styling.container) {
                containerCss += c + ':' + _optinSettings.styling.container[c] + ';';
            }

            var sdkRowCss = '';
            for (var c in _optinSettings.styling.sdkRow) {
                sdkRowCss += c + ':' + _optinSettings.styling.sdkRow[c] + ';';
            }

            var sdkContainerCss = '';
            for (var c in _optinSettings.styling.sdkContainer) {
                sdkContainerCss += c + ':' + _optinSettings.styling.sdkContainer[c] + ';';
            }

            var policyCss = '';
            for (var c in _optinSettings.styling.policy) {
                policyCss += c + ':' + _optinSettings.styling.policy[c] + ';';
            }

            var buttonGroupParentCss = '';
            for (var c in _optinSettings.styling.buttonGroupParent) {
                buttonGroupParentCss += c + ':' + _optinSettings.styling.buttonGroupParent[c] + ';';
            }

            var buttonGroupCss = '';
            for (var c in _optinSettings.styling.buttonGroup) {
                buttonGroupCss += c + ':' + _optinSettings.styling.buttonGroup[c] + ';';
            }

            var cookieSettingsButtonCss = '';
            for (var c in _optinSettings.styling.cookieSettingsButton) {
                cookieSettingsButtonCss += c + ':' + _optinSettings.styling.cookieSettingsButton[c] + ';';
            }

            var acceptButtonCss = '';
            for (var c in _optinSettings.styling.acceptButton) {
                acceptButtonCss += c + ':' + _optinSettings.styling.acceptButton[c] + ';';
            }

            //#endregion css replacements

            //compile the html
            return '<div id="sfc" style="' + rootCss + '" class="optin-sdk-root" style="bottom: 0px">' +
                '<div role="dialog" aria-describedby="optin-policy-text">' +
                '<div style="' + containerCss + '" class="optin-sdk-container">' +
                '<div style="' + sdkRowCss + '" class="optin-sdk-row">' +
                '<div style="' + sdkContainerCss + '" class="optin-sdk-container">' +
                '<div style="' + policyCss + '" class="optin-policy">' +
                '<p class="sf-policy-text">' + _optinSettings.config.html + '</p>' +
                '</div>' +
                '</div>' +
                '<div style="' + buttonGroupParentCss + '" class="optin-button-group-parent">' +
                '<div style="' + buttonGroupCss + '" class="optin-button-group">' +
                '<button style="' + cookieSettingsButtonCss + '" class="optin-cookie-setting-link">' + _optinSettings.config.settingsButtonText + '</button>' +
                '<button style="' + acceptButtonCss + '" class="optin-accept-btn-handler">' + _optinSettings.config.acceptButtonText + '</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';

        },

        BuildModalHtml: function () {

            var html = '<div class="modal fade" id="optin-cookie-settings" role="dialog">' +
                '<div class="modal-dialog" role="document">' +
                '<div class="modal-content" style="text-align: initial;">' +
                '<div class="modal-header">' +
                '<button type="button" class="close" data-dismiss="modal" aria-label="Close"><i class="fa fa-close"></i></button>' +
                '<h4 class="modal-title">Privacy Preference Center</h4>' +
                '</div>' +
                '<div class="modal-body">' +
                '<div class="optin-content">' +
                '<div class="optin-description">' +
                'When you visit any website, it may store or retrieve information on your browser, mostly in the form of cookies. This information might be about you, your preferences or your device and is mostly used to make the site work as you expect it to. The information does not usually directly identify you, but it can give you a more personalized web experience. Because we respect your right to privacy, you can choose not to allow some types of cookies. Click on the different category headings to find out more and change our default settings. However, blocking some types of cookies may impact your experience of the site and the services we are able to offer.' +
                '<br>' +
                '<a href="https://cookiepedia.co.uk/giving-consent-to-cookies" class="optin-privacy-notice-link" style="text-decoration: underline;" rel="noopener" target="_blank" aria-label="More information about your privacy, opens in a new window" tabindex="0">More information</a>' +
                '</div>' +
                '<div style="padding:15px 0;">' +
                '<button id="optin-accept-recommended-button" class="btn" tabindex="0" style="display: inline-block;">Allow All</button>' +
                '</div>' +
                '<div class="panel-group" id="optin-accordion">' +
                '<div class="panel panel-default">' +
                '<div class="panel-heading" style="cursor:pointer;" data-toggle="collapse" data-parent="#optin-accordion" data-target="#optin-accordion-necessary">' +
                '<h4 class="panel-title">' +
                '<a class="accordion-toggle">' +
                'Strictly Necessary Cookies' +
                '</a>' +
                '<label class="form-switch">' +
                '<input disabled="disabled" class="disabled" checked="checked" type="checkbox">' +
                '<i style="background-color: #e6e6e6; "></i>' +
                '</label>' +
                '</h4>' +
                '</div>' +
                '<div id="optin-accordion-necessary" class="panel-collapse collapse">' +
                '<div class="panel-body">' +
                'These cookies are necessary for the website to function and cannot be switched off in our systems. They are usually only set in response to actions made by you which amount to a request for services, such as setting your privacy preferences, logging in or filling in forms. You can set your browser to block or alert you about these cookies, but some parts of the site will not then work. These cookies do not store any personally identifiable information.' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<div class="panel panel-default">' +
                '<div class="panel-heading" style="cursor:pointer;">' +
                '<h4 class="panel-title" data-toggle="collapse" data-parent="#optin-accordion" data-target="#optin-accordion-performance">' +
                '<a class="accordion-toggle">' +
                'Performance Cookies' +
                '</a>' +
                '<label class="form-switch">' +
                '<input id="optin-performance-setting" type="checkbox">' +
                '<i></i>' +
                '</label>' +
                '</h4>' +
                '</div>' +
                '<div id="optin-accordion-performance" class="panel-collapse collapse">' +
                '<div class="panel-body">' +
                'These cookies allow us to count visits and traffic sources so we can measure and improve the performance of our site. They help us to know which pages are the most and least popular and see how visitors move around the site. All information these cookies collect is aggregated and therefore anonymous. If you do not allow these cookies we will not know when you have visited our site, and will not be able to monitor its performance.' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<div class="panel panel-default">' +
                '<div class="panel-heading" style="cursor:pointer;">' +
                '<h4 class="panel-title" data-toggle="collapse" data-parent="#optin-accordion" data-target="#optin-accordion-functional">' +
                '<a class="accordion-toggle">' +
                'Functional Cookies' +
                '</a>' +
                '<label class="form-switch">' +
                '<input id="optin-functional-setting" type="checkbox">' +
                '<i></i>' +
                '</label>' +
                '</h4>' +
                '</div>' +
                '<div id="optin-accordion-functional" class="panel-collapse collapse">' +
                '<div class="panel-body">' +
                'These cookies enable the website to provide enhanced functionality and personalisation. They may be set by us or by third party providers whose services we have added to our pages. If you do not allow these cookies then some or all of these services may not function properly.' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<div class="panel panel-default">' +
                '<div class="panel-heading" style="cursor:pointer;">' +
                '<h4 class="panel-title" data-toggle="collapse" data-parent="#optin-accordion" data-target="#optin-accordion-targeting">' +
                '<a class="accordion-toggle">' +
                'Targeting Cookies' +
                '</a>' +
                '<label class="form-switch">' +
                '<input id="optin-targeting-setting" type="checkbox">' +
                '<i></i>' +
                '</label>' +
                '</h4>' +
                '</div>' +
                '<div id="optin-accordion-targeting" class="panel-collapse collapse">' +
                '<div class="panel-body">' +
                'These cookies are set by a range of social media services that we have added to the site to enable you to share our content with your friends and networks. They are capable of tracking your browser across other sites and building up a profile of your interests. This may impact the content and messages you see on other websites you visit. If you do not allow these cookies you may not be able to use or see these sharing tools.' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '<div class="form-group">' +
                '<button type="button" class="btn" id="optin-confirm">Confirm My Choices</button>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>' +
                '</div>';

            return html;

        },

        BindClicks: function () {

            $('.optin-cookie-setting-link').on('click', function () {
                $('#optin-cookie-settings').modal();
            });

            $('.optin-accept-btn-handler').on('click', function () {
                $('#optin-performance-setting').prop('checked', 'checked');
                $('#optin-functional-setting').prop('checked', 'checked');
                $('#optin-targeting-setting').prop('checked', 'checked');

                functions.SaveSettings(true);
                var settings = functions.LoadSettings();
                functions.ApplySettings(settings, true);
            });

            // Don't collapse on checkbox click
            $('#optin-cookie-settings').find('label').on('click', function (e) {
                e.stopPropagation();
            });

            $('#optin-confirm').on('click', function () {
                functions.SaveSettings(true);
                var settings = functions.LoadSettings();
                functions.ApplySettings(settings, true);
            });

            $('#optin-accept-recommended-button').on('click', function () {

                $('#optin-performance-setting').prop('checked', 'checked');
                $('#optin-functional-setting').prop('checked', 'checked');
                $('#optin-targeting-setting').prop('checked', 'checked');

                functions.SaveSettings(true);

                var settings = functions.LoadSettings();
                functions.ApplySettings(settings, true);
            });

        },

        ApplySettings: function (settings, visuals) {

            if (visuals) {
                //apply settings to the checkboxes
                if (settings.performance == true)
                    $('#optin-performance-setting').prop('checked', 'checked');
                else
                    $('#optin-performance-setting').prop('checked', '');

                if (settings.functional == true)
                    $('#optin-functional-setting').prop('checked', 'checked');
                else
                    $('#optin-functional-setting').prop('checked', '');

                if (settings.targeting == true)
                    $('#optin-targeting-setting').prop('checked', 'checked');
                else
                    $('#optin-targeting-setting').prop('checked', '');
            }

            _performance = settings.performance;
            _functional = settings.functional;
            _targeting = settings.targeting;

            //initialize the libraries
            functions.InitLibraries();
        },

        InitLibraries: function () {

            //Google Analytics
            if (_performanceKeys["Google Analytics"] && _performance) {

                window['GoogleAnalyticsObject'] = 'ga';
                window['ga'] = window['ga'] || function () {
                    (window['ga'].q = window['ga'].q || []).push(arguments)
                },
                    window['ga'].l = 1 * new Date();
                var a = document.createElement('script');
                var m = document.getElementsByTagName('script')[0];
                a.async = 1;
                a.src = 'https://www.google-analytics.com/analytics.js';
                m.parentNode.insertBefore(a, m);

                ga('create', _performanceKeys["Google Analytics"], 'auto');
                ga('send', 'pageview');
            }

            //Google Tag Manager
            if (_performanceKeys["Google Tag Manager"] && _performance) {

                window['dataLayer'] = window['dataLayer'] || [];

                window['dataLayer'].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });

                var f = document.getElementsByTagName('script')[0],
                    j = document.createElement('script');
                j.async = true;
                j.src = 'https://www.googletagmanager.com/gtm.js?id=' + _performanceKeys["Google Tag Manager"] + '&l=dataLayer';
                f.parentNode.insertBefore(j, f);
            }

            for (var l in _customRegistrations) {
                var lib = _customRegistrations[l];
                if (lib.t == 'performance' && _performance) lib.callback();
                if (lib.t == 'functional' && _functional) lib.callback();
                if (lib.t == 'targeting' && _targeting) lib.callback();
            }
        },

        LoadSettings: function () {

            var cookie = functions.GetCookie();
            if (cookie == '') {
                //save the cookie
                functions.SetCookie(_optinSettings.defaults);

                //set variables
                _performance = _optinSettings.performance;
                _functional = _optinSettings.functional;
                _targeting = _optinSettings.targeting;

                return functions.LoadSettings();
            }

            return JSON.parse(cookie);
        },

        GetCookie: function () {

            var cookieName = 'sf:optin';

            // Split cookie string and get all individual name=value pairs in an array
            var cookieArr = document.cookie.split(";");

            // Loop through the array elements
            for (var i = 0; i < cookieArr.length; i++) {
                var cookiePair = cookieArr[i].split("=");

                /* Removing whitespace at the beginning of the cookie name
                and compare it with the given string */
                if (cookieName == cookiePair[0].trim()) {
                    // Decode the cookie value and return
                    return cookiePair[1];
                }
            }

            // Return empty string if not found
            return '';
        },

        SetCookie: function (settings) {
            if (optinMaxAgeMinutes > 0) document.cookie = "sf:optin=" + JSON.stringify(settings) + '; samesite=Strict; secure; path=/;max-age=' + (optinMaxAgeMinutes * 60) + ';';
            else document.cookie = "sf:optin=" + JSON.stringify(settings) + '; samesite=Strict; secure; path=/;';
        },

        SaveSettings: function (fromModal) {

            //get the settings
            var settings = {
                performance: $('#optin-performance-setting').is(':checked'),
                functional: $('#optin-functional-setting').is(':checked'),
                targeting: $('#optin-targeting-setting').is(':checked'),
                consent: false
            };

            if (fromModal) {
                //hide the modal
                $('#optin-cookie-settings').modal('hide');

                //hide the banner
                $('#sfc').css('bottom', '-200px');

                settings.consent = true;
            }

            //save the cookie
            functions.SetCookie(settings);

            //set variables
            _performance = settings.performance;
            _functional = settings.functional;
            _targeting = settings.targeting;
        },

        Add: function (key, value, type) {

            if (type === 'performance')
                _performanceKeys[key] = value;

            if (type === 'functional')
                _functionalKeys[key] = value;

            if (type === 'targeting')
                _targetingKeys[key] = value;
        }
    }

    return {
        Initialize: init,
        performance: functions.AllowPerformance,
        functional: functions.AllowFunctional,
        targeting: functions.AllowTargeting,
        Add: functions.Add,
        onInit: function (callback) {
            var settings = functions.LoadSettings();
            callback(settings);
        },
        Register: function (type, callback) {
            _customRegistrations.push({ t: type, callback: callback });
        }
    };
})(jQuery);
var MultiQuote = (function ($) {
	let Options = {
		DocumentId: 0,
		FilterUrl:"",
		IQDetails: new Object,
		GaConnector: new Object
	},

		Initialize = {
			Main: function (settings) {
				Options.FilterUrl = settings.FilterUrl;
				Initialize.GaConnectorData();
			},
			GaConnectorData: function () {
				Options.GaConnector.FcCampaign = GaConnector.GetByName("fc_campaign");
				Options.GaConnector.FcChannel = GaConnector.GetByName("fc_channel");
				Options.GaConnector.FcContent = GaConnector.GetByName("fc_content");
				Options.GaConnector.FcLanding = GaConnector.GetByName("fc_landing");
				Options.GaConnector.FcMedium = GaConnector.GetByName("fc_medium");
				Options.GaConnector.FcSource = GaConnector.GetByName("fc_source");
				Options.GaConnector.FcTerm = GaConnector.GetByName("fc_term");
				Options.GaConnector.LcCampaign = GaConnector.GetByName("lc_campaign");
				Options.GaConnector.LcChannel = GaConnector.GetByName("lc_channel");
				Options.GaConnector.LcContent = GaConnector.GetByName("lc_content");
				Options.GaConnector.LcLanding = GaConnector.GetByName("lc_landing");
				Options.GaConnector.LcMedium = GaConnector.GetByName("lc_medium");
				Options.GaConnector.LcSource = GaConnector.GetByName("lc_source");
				Options.GaConnector.LcTerm = GaConnector.GetByName("lc_term");
				Options.GaConnector.Os = GaConnector.GetByName("OS");
				Options.GaConnector.GaClientId = GaConnector.GetByName("GA_Client_ID");
				Options.GaConnector.Browser = GaConnector.GetByName("browser");
				Options.GaConnector.City = GaConnector.GetByName("city");
				Options.GaConnector.Country = GaConnector.GetByName("country");
				Options.GaConnector.Device = GaConnector.GetByName("device");
				Options.GaConnector.PageVisits = GaConnector.GetByName("page_visits");
				Options.GaConnector.PagesVisitedList = GaConnector.GetByName("pages_visited_list");
				Options.GaConnector.Region = GaConnector.GetByName("region");
				Options.GaConnector.TimeZone = GaConnector.GetByName("time_zone");
				Options.GaConnector.TimePassed = GaConnector.GetByName("time_passed");
				Options.GaConnector.Latitude = GaConnector.GetByName("latitude");
				Options.GaConnector.Longitude = GaConnector.GetByName("longitude");
			}
		},

		WorkFlow = {
			Validate: function (btn) {
				let form = $("#multi-quote-form");

				$.validator.addMethod("mqPhone", function (value, element) {
					return this.optional(element) || /^[+]*[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\./0-9]*$/.test(value);
				}, "Please enter a valid phone number.");

				$(form).validate({
					rules: {
						ToEmail: {
							required: true,
							email: true
						},
						Name: "required",
						Phone: {
							required: true,
							minlength: 10,
							mqPhone: true
						}
					},
					messages: {
						ToEmail: "Please enter a valid email address",
						Name: "Please enter your firstname",
						Phone: "Please enter a valid phone number"
					}
				});

				let valid = $(form).valid();

				if (!valid) {
					Button.Reset(btn, '<i class="fa fa-envelope"></i> Email Me This Quote');
				}

				Options.IQDetails.DocumentId = Options.DocumentId;
				Options.IQDetails.ToEmail = $(form).find('input[name="ToEmail"]').val();
				Options.IQDetails.CcEmail = $(form).find('input[name="CcEmail"]').val();
				Options.IQDetails.Company = $(form).find('input[name="Company"]').val();
				Options.IQDetails.Name = $(form).find('input[name="Name"]').val();
				Options.IQDetails.Phone = $(form).find('input[name="Phone"]').val();

				return valid;
			},
			Load: function (documentId) {
				if (documentId > 0) Options.DocumentId = documentId;

				$.get("/creativebrands/multiquote/load").done(function (result) {
					$("#multiQuoteModal .modal-body").html(result);
					$("#multiQuoteModal").modal("toggle");
				});
			},
			Email: function (btn) {
				Button.Configure(btn, "Sending...", true, true);

				let valid = WorkFlow.Validate(btn);

				if (valid) {
					$.post(Options.FilterUrl.concat("/send"), {
						documentId: Options.DocumentId,
						quote: Options.IQDetails,
						tracking: Options.GaConnector
					}).done(function (result) {
						Utils.Notify({
							style: result.Success ? "success" : "error",
							message: result.Message
						});
						Button.Reset(btn, '<i class="fa fa-envelope"></i> Email Me This Quote');
						setTimeout(function () {
							$("#multiQuoteModal").modal("toggle");
						}, 1000);
					});
				}
			}
		},

		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		}

	return {
		Initialize: Initialize,
		WorkFlow: WorkFlow
	}
})(jQuery);
var NewsLetter = (function ($) {
	let Options = {
		FilterUrl: "",
		Details: new Object
	},

		Initialize = function (settings) {
			Options.FilterUrl = settings.FilterUrl;
		},

		WorkFlow = {
			Validate: function (btn) {
				let form = $("#newsletterSubForm");

				$(form).validate({
					rules: {
						name: "required",
						surname: "required",
						email: {
							required: true,
							email: true
						}
					},
					messages: {
						name: "Please enter your name",
						surname: "Please enter your surname",
						email: "Please enter your email address"
					}
				});

				let valid = $(form).valid();

				if (!valid) {
					Button.Reset(btn, "Signup");
				}

				Options.Details.Email = $(form).find('input[name="email"]').val();
				Options.Details.Name = $(form).find('input[name="name"]').val();
				Options.Details.Surname = $(form).find('input[name="surname"]').val();

				return valid;
			},
			Subscribe: function (btn) {
				Button.Configure(btn, "Loading...", true, true);

				let valid = WorkFlow.Validate(btn);

				if (valid) {
					$.post(Options.FilterUrl.concat("/subscribe"), Options.Details).done(function (result) {
						Utils.Notify({
							style: result.Success ? "success" : "error",
							message: result.Message
						});

						Button.Reset(btn, "Signup");

						if (result.Success) {
							window.dataLayer = window.dataLayer || [];
							window.dataLayer.push({
								'event': 'NewsletterSuccess' // Static value for successful newsletter sign up
							});

							$(form).find("#email").val("");
							$(form).find("#name").val("");
							$(form).find("#surname").val("");
						}
					});
				}
			}
		},

		Button = {
			Configure: function (element, text, disable, spinner) {
				let textElement = '<i class="fa fa-spinner fa-pulse fa-1x fa-fw"></i> '.concat(text);
				if (disable) $(element).prop("disabled", true);
				if (!spinner) textElement = text;

				$(element).html(textElement);
			},
			Reset: function (element, text) {
				$(element).prop("disabled", false);
				$(element).html(text);
			}
		}

	return {
		Initialize: Initialize,
		WorkFlow: WorkFlow
	}
})(jQuery);
var Order = (function ($) {
	let Options = {
		FilterUrl: "",
		LoaderUrl: "",
		TotalOrders: 0,
		DocumentId: 0
	},

		Initialize = {
			Main: function (settings) {
				Options.LoaderUrl = settings.LoaderUrl;
				Options.TotalOrders = settings.TotalOrders;
			},
			Filter: function (filterUrl) {
				Options.FilterUrl = filterUrl;
				WorkFlow.Filter($("#ordersPlaced").val());
			}
		},

		WorkFlow = {
			Load: function (documentId) {
				Options.DocumentId = documentId;
				$("#cancelOrderModal").modal("toggle");
			},
			Filter: function (type) {
				$("#ordersContainer").html("<div class='text-center'><img style='height: 125px;' src='".concat(Options.LoaderUrl, "' alt='' /></div>"));

				$.ajax({
					type: 'GET',
					url: "/creativebrands/order/filterorders",
					cache: false,
					dataType: 'html',
					data: {
						filter: type
					},
					beforeSend: function () {
						UI.Loader.Show({
							text: 'Fetching'
						});
					},
					success: function (result) {
						$("#ordersPlaced").val(type);
						$("#ordersContainer").html(result);
						$("#totalOrders").html(Options.TotalOrders);
					},
					error: function (xhr, error) {
						console.error(error);

					},
					complete: function () {
						UI.Loader.Hide();
					}
				});
			},
			Cancel: function () {
				$.post(Options.FilterUrl.concat("/cancel"), { id: Options.DocumentId }).done(function (result) {
					window.location.href = result;
				});
			}
		}

	return {
		Initialize: Initialize,
		WorkFlow: WorkFlow
	}
})(jQuery);
var Project = (function ($) {

	let Options = {
		FilterUrl: "",
		LoaderUrl: "",
		DocumentId: 0,
		DocumentLineId: 0,
		ProductId: 0
	},

		Initialize = {
			Main: function (settings) {
				Options.FilterUrl = settings.FilterUrl;
				Options.LoaderUrl = settings.LoaderUrl;

				if (window.location.pathname === Options.FilterUrl) {
					WorkFlow.Configure.DropDown($("#projectTotalCount").val(), "#projectPage", $("#projectPageSize").val());
				}
			},
			Review: function (settings) {
				Options.FilterUrl = settings.FilterUrl;
			}
		},

		Load = {
			Delete: function (documentId, name) {
				Options.DocumentId = documentId;

				$("#deleteProjectModal .modal-header label").text(name);
				$("#deleteProjectModal").modal("toggle");
			},
			Layout: function (layout, ordersPlaced, documentId, documentLineId, productId, layoutStatus) {
				if (layout.includes("pdf")) {
					$("#layoutModal #layoutImage").hide();
					$("#layoutModal #layoutPdf").removeClass("hide").attr("href", layout);
				} else {
					$("#layoutModal #layoutPdf").hide();
					$("#layoutModal #layoutImage").removeClass("hide").attr("src", layout + "?v=" + Math.floor(Math.random() * 10000));
				}

				if (!ordersPlaced) {
					Options.DocumentId = documentId;
					Options.DocumentLineId = documentLineId;
					Options.ProductId = productId;

					if (layoutStatus === "Approved") {
						$("#layoutModal #approveLayout").addClass("hide");
						$("#layoutModal #declineLayout").addClass("hide");
					}
				}

				$("#layoutModal").modal("toggle");
			},
			RequestChange: function (hideLayout, documentId, documentLineId, productId, layoutStatus) {
				if (hideLayout) {
					$("#layoutModal").modal("toggle");
					$("#requestChangeModal").modal("toggle");
				} else {
					Options.DocumentId = documentId;
					Options.DocumentLineId = documentLineId;
					Options.ProductId = productId;

					if (layoutStatus === "Approved") {
						$("#layoutModal #approveLayout").addClass("hide");
						$("#layoutModal #declineLayout").addClass("hide");
					}

					$("#requestChangeModal").modal("toggle");
				}
			}
		},

		WorkFlow = {
			Delete: function () {
				$.post(Options.FilterUrl.concat("/delete"), { id: Options.DocumentId }).done(function (result) {
					Utils.Notify({
						style: result.Success ? "success" : "error",
						message: result.Message
					});

					window.location.href = Options.FilterUrl;
				});
			},
			Configure: {
				DropDown: function (count, selector, page) {
					let pageSize = 10;
					let pages = Math.ceil(count / pageSize);
					$(selector).html("");
					for (let p = 1; p <= pages; p++) {
						$(selector).append($("<option>").attr("value", p).html(p));
					}
					if (pages === 1) {
						$(selector).attr("disabled", "disabled");
					}
					else {
						$(selector).removeAttr("disabled");
					}
					$(selector).val(page);

					WorkFlow.Configure.Buttons(selector, $(selector).val());
				},
				Buttons: function (selector, value) {
					if (value === $(selector).children("option").first().val()) {
						$(selector).siblings(".project-prev-btn").addClass("disabled");
					}
					else {
						$(selector).siblings(".project-prev-btn").removeClass("disabled");
					}

					if (value === $(selector).children("option").last().val()) {
						$(selector).siblings(".project-next-btn").addClass("disabled");
					}
					else {
						$(selector).siblings(".project-next-btn").removeClass("disabled");
					}
				},
				Loader: function (element) {
					$("#".concat(element)).html("<div class='text-center'><img style='height: 125px;' src='".concat(Options.LoaderUrl, "' alt='' /></div>"));
				}
			},
			Next: function () {
				let select = $("#projectPage").attr("id");
				if (select === "projectPage") {

					let list = $("#projectPage");
					let firstVal = list.children("option:selected").next().val();

					WorkFlow.Configure.Buttons("#" + list.attr("id"), firstVal);
					list.val(firstVal);

					$("#projectPage").val(firstVal).trigger("chosen:updated");
				}

				WorkFlow.Configure.Loader("pageContainer");

				$.get(Options.FilterUrl.concat("/pageload"), {
					page: (parseInt($("#projectPageSize").val()) + 1),
					pageSize: 10
				}).done(function (result) {
					$("#pageContainer").html(result);
					$("#projectPageSize").val(parseInt($("#projectPageSize").val()) + 1);
				});
			},
			Previous: function () {
				let select = $("#projectPage").attr("id");
				if (select === "projectPage") {

					let list = $("#projectPage");
					let firstVal = list.children("option:selected").prev().val();

					WorkFlow.Configure.Buttons("#" + list.attr("id"), firstVal);
					list.val(firstVal);

					$("#projectPage").val(firstVal).trigger("chosen:updated");
				}

				WorkFlow.Configure.Loader("pageContainer");

				$.get(Options.FilterUrl.concat("/pageload"), {
					page: (parseInt($("#projectPageSize").val()) - 1)
				}).done(function (result) {
					$("#pageContainer").html(result);
					$("#projectPageSize").val(parseInt($("#projectPageSize").val()) - 1);
				});
			},
			Select: function (element) {
				WorkFlow.Configure.Buttons("#" + $(element).attr("id"), $(element).val());
				WorkFlow.Configure.Loader("pageContainer");

				$.get(Options.FilterUrl.concat("/pageload"), {
					page: $(element).val()
				}).done(function (result) {
					$("#pageContainer").html(result);
				});
			},
			Layout: {
				Approve: function () {
					$.post(Options.FilterUrl.concat("/review/approvelayout"), {
						documentId: Options.DocumentId,
						documentLineId: Options.DocumentLineId,
						productId: Options.ProductId
					}).done(function (result) {
						Utils.Notify({
							style: result.Success ? "success" : "error",
							message: result.Message
						});

						if (result.Success) {
							$("#layoutModal").modal("toggle");
							window.location.href = Options.FilterUrl.concat("/review/index?documentId=", Options.DocumentId);
						}
					});
				},
				Decline: function (message) {
					$.post(Options.FilterUrl.concat("/review/declinelayout"), {
						documentId: Options.DocumentId,
						documentLineId: Options.DocumentLineId,
						productId: Options.ProductId,
						message: message
					}).done(function () {
						Utils.Notify({
							style: result.Success ? "success" : "error",
							message: result.Message
						});

						if (result.Success) {
							$("#requestChangeModal").modal("toggle");
							window.location.href = Options.FilterUrl.concat("/review/index?documentId=", Options.DocumentId);
						}
					});
				}
			}
		}

	return {
		Initialize: Initialize,
		Load: Load,
		WorkFlow: WorkFlow
	}
})(jQuery);